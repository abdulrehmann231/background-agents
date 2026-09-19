import "server-only"

import { Prisma } from "@prisma/client"
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
 * There is deliberately no provider-wide rung beneath these two. Pooling every
 * model the provider serves would mean quoting a blend of other models' prices:
 * each turn is priced at the rates it actually ran on, so a Fable turn enters at
 * $10/M against Haiku's $1/M. Over 60 days of production that blend came to
 * $0.1970, which is 4.2x under Fable's own figure and 1.8x over Haiku's. It
 * cannot be rescued by re-pricing the borrowed volumes at the selected model's
 * rates either, because the selection is an alias the ledger never sees — see
 * pricedModelsTable. Showing nothing is the honest answer, and it costs almost
 * nothing: every selection with real traffic clears the 20-turn model floor.
 */
const SCOPE_ORDER = ["chat", "model"] as const

interface ScopeRow {
  scope: string
  n: number
  known_quote: number | null
}

/** Today's known-token rates for a model id as the ledger records it. */
function ratesFor(provider: string, model: string): KnownTokenRates | null {
  if (provider === "claude") return claudeKnownRatesFor(model)
  if (provider === "opencode") return openCodeKnownRatesFor(model)
  return null
}

/**
 * The priced model ids this provider has actually served lately, as a SQL table
 * of `(model, input, cacheRead, cacheWrite)`.
 *
 * The rates have to reach the query as data because the selection the user made
 * does not name a model the ledger would recognise. The composer's Claude ids
 * are aliases — `opus`, `default`, `best` — and the CLI resolves them at run
 * time to whatever version is current, so the id that comes back is
 * `claude-opus-4-8`. Worse, the mapping is not one-to-one: over the last 60 days
 * `fable` resolved to Fable 5 on 489 turns and to Opus 4.8 on 90, and `best`
 * split 60/44 between the two. A lookup table from alias to version would be
 * wrong for those two aliases immediately and for the rest at the next model
 * release.
 *
 * So nothing is translated. Each turn is priced at the rates of the model it
 * actually ran on, and the *selection* is matched separately against
 * `Message.model`, which is the same alias the composer is holding. A turn whose
 * model has no rates is dropped rather than guessed at.
 */
async function pricedModelsTable(provider: string, since: Date): Promise<Prisma.Sql | null> {
  const models = await prisma.tokenUsage.findMany({
    where: { provider, pool: "shared", freeModel: false, createdAt: { gte: since } },
    select: { model: true },
    distinct: ["model"],
  })

  const rows = models.flatMap(({ model }) => {
    if (!model) return []
    const rates = ratesFor(provider, model)
    if (!rates) return []
    return [
      Prisma.sql`(${model}, ${rates.input}::float8, ${rates.cacheRead}::float8, ${rates.cacheWrite}::float8)`,
    ]
  })

  return rows.length > 0 ? Prisma.join(rows, ", ") : null
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
  chatId: string | null
  provider: string
  model: string | null
}): Promise<number | null> {
  const { chatId, provider, model } = params

  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000)

  // No priced model on this provider, no estimate. Guessing a price for models
  // we do not price is exactly the failure this approach exists to avoid.
  const rates = await pricedModelsTable(provider, since)
  if (!rates) return null

  const rows = await prisma.$queryRaw<ScopeRow[]>`
    WITH rates(model, input, cache_read, cache_write) AS (VALUES ${rates}),
    deduped AS (
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
    -- Priced per model rather than per turn, because a turn can span models when
    -- an agent switches mid-run. Each part is charged at what it actually ran on
    -- and the parts are added back up below.
    priced AS (
      SELECT d."messageId",
             MAX(d."createdAt") AS metered_at,
             -- Re-priced at today's rates rather than read back in the dollars
             -- recorded at the time: the token counts are the measurement, the
             -- rates are current.
             ( r.input       * SUM(d."inputTokens")
             + r.cache_read  * SUM(d."cacheReadTokens")
             + r.cache_write * SUM(d."cacheWriteTokens")
             ) / 1000000.0 AS known_usd
      FROM deduped d
      JOIN rates r ON r.model = d.model
      GROUP BY d."messageId", r.input, r.cache_read, r.cache_write
    ),
    turns AS (
      SELECT "messageId", MAX(metered_at) AS metered_at, SUM(known_usd) AS known_usd
      FROM priced GROUP BY 1
    ),
    timed AS (
      SELECT t.known_usd, m.model, m."chatId"
      FROM turns t
      JOIN "Message" m ON m.id = t."messageId"
      WHERE EXTRACT(epoch FROM (t.metered_at - m."createdAt"))
              BETWEEN ${MIN_TURN_SECONDS} AND ${MAX_TURN_SECONDS}
    ),
    -- Matched on the id the composer is holding, which is what Message.model
    -- stores. See pricedModelsTable for why it is never compared to the ledger's.
    scoped AS (
      SELECT 'chat'::text AS scope, known_usd FROM timed
        WHERE ${chatId}::text IS NOT NULL AND "chatId" = ${chatId}
          AND model IS NOT DISTINCT FROM ${model}
      UNION ALL
      SELECT 'model', known_usd FROM timed WHERE model IS NOT DISTINCT FROM ${model}
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
