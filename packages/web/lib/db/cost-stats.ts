import "server-only"

import { prisma } from "./prisma"
import { getMultiplierFor } from "./provider-pricing"
import { claudeKnownRatesFor, type KnownTokenRates } from "@/lib/server/claude-pricing"
import { openCodeKnownRatesFor } from "@/lib/server/opencode-pricing"

/**
 * How far back the sample reaches. Long enough that a quiet model still clears
 * its sample floor, short enough that a change in how the agent works its way
 * out of the numbers within a couple of months.
 *
 * This bounds *token volumes*, not prices: every turn in the sample is re-priced
 * at today's rates, so a rate change no longer ages the window.
 */
const WINDOW_DAYS = 60

/**
 * Turns shorter than this are metering artefacts rather than runs, and turns
 * longer than it are almost always a run the user walked away from.
 */
const MIN_TURN_SECONDS = 3
const MAX_TURN_SECONDS = 3600

/**
 * The percentile of the known-token cost that gets quoted.
 *
 * Not the median, which was the first attempt. "Starts around $X" is a claim
 * about a lower bound, and a median breaks that claim on 45% of sends — measured
 * across 4,886 production turns, 43-46% on every model with a real sample. The
 * 25th percentile holds on ~80% of them while staying within about 4x of what a
 * turn actually costs; the 10th holds on ~93% but quotes 8 cents against a
 * typical 92-cent Opus turn, which is a true statement that misleads.
 */
const QUOTE_PERCENTILE = 0.25

/**
 * Minimum turns before a scope may answer.
 *
 * The chat floor is far lower because a chat's own turns are much more alike
 * than turns in general — a 4.0x interquartile spread within a chat against
 * 13.8x across all turns on the same model — so five of them say more than
 * twenty drawn from everywhere.
 */
const MIN_SAMPLES_CHAT = 5
const MIN_SAMPLES_WIDE = 20

/**
 * Narrowest first — the first scope to clear its floor wins.
 *
 * `provider` pools turns across every model the provider serves, which is a sane
 * fallback only because the sample holds token volumes rather than dollars. How
 * much cache a turn reads is a property of the agent and the work, not of the
 * price list, so borrowing those volumes from a sibling model and pricing them
 * at the selected model's rates answers "what would a turn like this cost here".
 * Borrowing another model's *dollars* would have answered a question nobody
 * asked.
 */
const SCOPE_ORDER = ["chat", "model", "provider"] as const

interface ScopeRow {
  scope: string
  n: number
  known_quote: number | null
}

/** Today's known-token rates for a model, or null when neither provider prices it. */
function ratesFor(provider: string, model: string | null): KnownTokenRates | null {
  if (provider === "claude") return claudeKnownRatesFor(model)
  if (provider === "opencode") return openCodeKnownRatesFor(model)
  return null
}

/**
 * What the next turn starts at, in USD, or null when there is nothing honest to
 * quote.
 *
 * Cost is not a quantity to be predicted — it is exact arithmetic on four token
 * counts, and both providers' rate tables are in this repo. What would have to
 * be predicted is the *token counts*, and one of them dominates: on the busiest
 * Claude model the median turn spends 2.7K input and 4.9K output tokens against
 * 703K of cache reads, so most of the volume is the agent loop re-sending
 * context, and the loop's length is what nothing pre-send can know. Predicting a
 * turn's cost from history — this chat's included — misses by 175-430% of the
 * median, so this does not predict. It prices the half of a turn that is settled
 * before the model writes anything (input, cache reads, cache writes) and quotes
 * a low percentile of it.
 *
 * Token volumes are sampled from turns that actually ran and re-priced here,
 * rather than read back as the dollars recorded at the time. The distinction is
 * not academic: MiMo v2.5 Pro's rates fell about 4x mid-window, and an estimate
 * built from recorded dollars would have quoted the old price for weeks after it
 * stopped existing. Token counts are physical; prices go stale.
 *
 * Three quirks of the underlying table are handled here rather than left to
 * callers, because each one silently corrupts an aggregate:
 *
 *   - Metering writes a float-residue row (zero tokens, a cost around 1e-13)
 *     alongside the real one, and a race can write the real row twice. Both land
 *     at the same `cumulativeTotal`, so de-duplicating on (message, session,
 *     cumulativeTotal, model) and keeping the largest row collapses them while
 *     preserving the several genuine deltas one turn can produce.
 *   - A batch of rows is backdated to the epoch, which any relative window would
 *     otherwise sweep in.
 *   - `Message.createdAt` is stamped when a turn *starts*, so it cannot give a
 *     duration on its own; the turn's last `TokenUsage` row marks the end.
 */
export async function getCostEstimate(params: {
  userId: string
  chatId: string | null
  provider: string
  model: string | null
}): Promise<number | null> {
  const { chatId, provider, model } = params

  // No rate table, no estimate. Guessing a price for a model we do not price is
  // exactly the failure this approach exists to avoid.
  const rates = ratesFor(provider, model)
  if (!rates) return null

  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000)

  const rows = await prisma.$queryRaw<ScopeRow[]>`
    WITH deduped AS (
      SELECT DISTINCT ON (tu."messageId", tu."sessionId", tu."cumulativeTotal", tu.model)
             tu."messageId", tu.model, tu."createdAt",
             tu."inputTokens", tu."cacheReadTokens", tu."cacheWriteTokens"
      FROM "TokenUsage" tu
      WHERE tu.provider = ${provider}
        AND tu."createdAt" >= ${since}
        AND tu."createdAt" > TIMESTAMP '1990-01-01'
        AND tu."freeModel" = false
        AND tu.pool = 'shared'
        AND tu."messageId" IS NOT NULL
      ORDER BY tu."messageId", tu."sessionId", tu."cumulativeTotal", tu.model,
               tu."totalTokens" DESC
    ),
    turns AS (
      SELECT d."messageId",
             MAX(d."createdAt") AS metered_at,
             -- Re-priced at today's rates rather than read back in the dollars
             -- recorded at the time: the token counts are the measurement, the
             -- rates are current.
             ( ${rates.input}::float8      * SUM(d."inputTokens")
             + ${rates.cacheRead}::float8  * SUM(d."cacheReadTokens")
             + ${rates.cacheWrite}::float8 * SUM(d."cacheWriteTokens")
             ) / 1000000.0 AS known_usd,
             -- A turn can span models (an agent switching mid-run). Attribute it
             -- whole to whichever carried the most tokens, so it stays one
             -- observation.
             (ARRAY_AGG(d.model ORDER BY d."inputTokens" DESC))[1] AS model
      FROM deduped d
      GROUP BY 1
    ),
    timed AS (
      SELECT t.known_usd, t.model, m."chatId"
      FROM turns t
      JOIN "Message" m ON m.id = t."messageId"
      WHERE EXTRACT(epoch FROM (t.metered_at - m."createdAt"))
              BETWEEN ${MIN_TURN_SECONDS} AND ${MAX_TURN_SECONDS}
    ),
    scoped AS (
      SELECT 'chat'::text AS scope, known_usd FROM timed
        WHERE ${chatId}::text IS NOT NULL AND "chatId" = ${chatId}
          AND model IS NOT DISTINCT FROM ${model}
      UNION ALL
      SELECT 'model', known_usd FROM timed WHERE model IS NOT DISTINCT FROM ${model}
      UNION ALL
      SELECT 'provider', known_usd FROM timed
    )
    SELECT scope,
           COUNT(*)::int AS n,
           percentile_cont(${QUOTE_PERCENTILE}) WITHIN GROUP (ORDER BY known_usd) AS known_quote
    FROM scoped
    GROUP BY scope
  `

  const byScope = new Map(rows.map((r) => [r.scope, r]))
  const multiplier = await getMultiplierFor(provider)

  for (const scope of SCOPE_ORDER) {
    const row = byScope.get(scope)
    if (!row) continue
    if (row.n < (scope === "chat" ? MIN_SAMPLES_CHAT : MIN_SAMPLES_WIDE)) continue

    // A scope can clear the floor on turn count and still quote nothing — every
    // turn served by a zero-multiplier provider, say. "$0.0000" would read as a
    // promise rather than an absence, so fall through instead.
    const quote = (row.known_quote ?? 0) * multiplier
    if (quote > 0) return quote
  }

  return null
}
