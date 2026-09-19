/**
 * First-party OpenCode Go token rates, for the pre-send cost estimate.
 *
 * The companion to {@link ./claude-pricing}'s `claudeKnownRatesFor`, and exists for
 * the same reason: the estimate prices token counts it is sampling rather than
 * a turn whose counts are known, so it needs the coefficients themselves.
 *
 * Unlike Claude, OpenCode's cache-read rate is not a fixed multiple of input —
 * it runs from 0.8% of input (MiMo) to 20% (Kimi) — so each model carries its
 * own rates rather than deriving them from one.
 *
 * Rates were solved against recorded billing rather than copied from a rate
 * card, because the two disagree: the model list in `@background-agents/common`
 * still prices DeepSeek V4 Pro input at $0.66/M where billing fits $0.44/M.
 * Checked against 90 days of the production ledger — these reproduce `costUsd`
 * exactly for six of the eight models and to within 0.85% for the other two.
 *
 * Metering is not routed through here. tokscale's own `costUsd` already prices
 * these turns correctly (that is what the check above measured), so a second
 * pricing path for the ledger would add risk without adding accuracy.
 */

import type { KnownTokenRates } from "./claude-pricing"

/**
 * USD per million tokens. Every rate is independent — none is derived.
 *
 * `output` is carried but unused by the estimate: it is what the solve was
 * checked against, and dropping it would leave the cache-read rates
 * unverifiable against the ledger.
 */
interface OpenCodeRate {
  input: number
  output: number
  cacheRead: number
}

/**
 * Rates keyed by the bare model id, the form `TokenUsage.model` records.
 *
 * Only models with enough billing history to solve are listed; anything else
 * returns null and shows no estimate rather than a guessed one.
 *
 * No cache-write rate: OpenCode reports zero cache-write tokens on every row in
 * the ledger, so the coefficient is both unidentifiable and unused.
 */
const OPENCODE_RATES: Record<string, OpenCodeRate> = {
  "glm-5.1": { input: 1.4, output: 4.4, cacheRead: 0.26 },
  "glm-5.2": { input: 1.4, output: 4.4, cacheRead: 0.26 },
  "kimi-k2.6": { input: 0.95, output: 4.0, cacheRead: 0.16 },
  "kimi-k2.7-code": { input: 0.95, output: 4.0, cacheRead: 0.19 },
  "deepseek-v4-pro": { input: 0.44, output: 0.87, cacheRead: 0.0036 },
  "minimax-m3": { input: 0.3, output: 1.2, cacheRead: 0.06 },
  "mimo-v2.5": { input: 0.14, output: 0.28, cacheRead: 0.0028 },
  "mimo-v2.5-pro": { input: 0.43, output: 0.87, cacheRead: 0.0037 },
}

/**
 * Reduce an OpenCode model id to its pricing key, or null when it isn't one we
 * price.
 *
 * The app addresses these models with a routing prefix (`opencode-go/glm-5.2`)
 * while tokscale records the bare id (`glm-5.2`), so both forms reach here and
 * both must land on the same key. Only the `opencode-go/` route is priced: an
 * `opencode/` model runs through Zen on pay-as-you-go credits at different
 * rates, and a `*-free` model costs nothing by design.
 */
export function normalizeOpenCodeModel(model: string | null | undefined): string | null {
  if (!model) return null
  const id = model.toLowerCase()
  if (id.startsWith("opencode/")) return null
  const bare = id.startsWith("opencode-go/") ? id.slice("opencode-go/".length) : id
  return bare in OPENCODE_RATES ? bare : null
}

/**
 * Expanded rates for a model, or null when it isn't one we price.
 *
 * `cacheWrite` is zero for the reason given on {@link OPENCODE_RATES}; it is
 * present only so both providers hand the estimate the same shape.
 */
export function openCodeKnownRatesFor(model: string | null | undefined): KnownTokenRates | null {
  const key = normalizeOpenCodeModel(model)
  if (!key) return null
  const rate = OPENCODE_RATES[key]
  return { input: rate.input, cacheRead: rate.cacheRead, cacheWrite: 0 }
}
