/**
 * Per-provider daily budgets for the shared credential pools.
 *
 * Budgets scale by plan: `free` gets the base daily budget, `pro` gets 2× that
 * budget (still daily), and `unlimited` is uncapped. A temporary, self-expiring
 * multiplier can sit on top of both — see `BUDGET_BOOSTS`. The budget *unit* differs
 * by provider — each pool is metered in whatever measure best reflects its cost:
 *   - claude   → "cost": USD spend, priced from Anthropic's published rates in
 *                lib/server/claude-pricing. The pool spans Haiku through Fable,
 *                a 10× spread in price per token, so a token cap would hand a
 *                Fable user ten times the value of a Haiku user for the same
 *                allowance.
 *   - opencode → "cost": USD spend (tokscale's per-turn cost), since OpenCode
 *                spans many models with wildly different per-token prices.
 *   - gemini   → "messages": number of assistant turns, a simple message cap.
 *
 * Unlike the token unit, "cost" counts cache reads and writes: they're priced
 * at 0.1× and 1.25× base input, so they no longer swamp the measure the way raw
 * cache token *counts* do.
 *
 * Omit a provider to leave it unlimited.
 */

import type { ProviderName } from "@background-agents/common"

/** Subscription tier (mirrors Prisma's `Plan` enum). */
export type Plan = "free" | "pro" | "unlimited"

/** Unit a provider's shared-pool budget is measured in. */
export type BudgetUnit = "tokens" | "cost" | "messages"

export interface ProviderBudget {
  unit: BudgetUnit
  /** Daily allowance in the unit: tokens, USD, or message count. */
  limit: number
}

/** Multiplier applied to the free daily budget for `pro` users. */
export const PRO_BUDGET_MULTIPLIER = 2

/**
 * Free-tier daily budget per shared-pool provider, with its unit.
 *
 * The Claude figure is sized from the ledger, not modelled. Over 77 active days
 * (Jun–Aug 2026): 106 users, 6,463 shared turns, $14,846 of API-equivalent
 * value — ~$193/day at ~11.9 users active per day, averaging $2.30 a turn. Note
 * a "turn" here is a whole agentic run (many API round-trips, each re-reading
 * cache), not a single call, which is why it costs orders of magnitude more than
 * a chat message.
 *
 * Cost per user-day was distributed:  p50 $8.37 · p75 $17.26 · p90 $42.55 ·
 * max $237.39. The tail is the problem this cap exists to solve — 8 of those 106
 * users accounted for 75% of all spend, and left alone they crowd everyone else
 * out as the pool grows.
 *
 * The old 100k-token cap it replaces was worth a median of $8.10 of real value
 * per user-day — but anywhere from $4.80 (p25) to $26.78 (p90), because the same
 * token allowance buys wildly different amounts depending on the model. That
 * spread is why a token cap never controlled the pool: we were hitting the
 * subscription's weekly limit (77 times in this window, plus 57 Fable-specific
 * and 26 session limits) while the cap looked like it was holding.
 *
 * $5/day sits below that $8.10 median, so it is a genuine tightening rather than
 * a sideways move. Replayed over the same history with plan multipliers applied,
 * it would have allowed ~$88/day against ~$193/day actual — a 54% reduction,
 * most of it taken off the tail the token rule let run unchecked.
 *
 * Two things this does NOT bound:
 *   - The `unlimited` plan, which is uncapped by definition. It accounted for
 *     $44/day of the historical draw, and no value here touches it.
 *   - The pool as a whole. This caps a single user; 200 users active at once is
 *     still 200 × the cap. A pool-wide daily ceiling is the only hard bound, and
 *     it does not exist yet.
 */
const FREE_DAILY_BUDGETS: Partial<Record<ProviderName, ProviderBudget>> = {
  claude: { unit: "cost", limit: 5 },
  // TODO(token-budgets): tune these two against the ledger, as above.
  opencode: { unit: "cost", limit: 0.5 },
  gemini: { unit: "messages", limit: 100 },
}

/**
 * A temporary boost to one provider's budgets, with a hard expiry.
 *
 * While live, the multiplier scales the free daily budget — and through it the
 * Pro budget, which is still `PRO_BUDGET_MULTIPLIER`× free. At `until` the
 * boost lapses on its own and the baseline returns; nothing has to be changed
 * back by hand.
 */
interface BudgetBoost {
  multiplier: number
  /** Instant the boost stops applying (exclusive). */
  until: Date
}

/**
 * Live boosts, keyed by provider.
 *
 * No boost is currently live — the Claude pool runs on its $5/$10 baseline.
 * Add an entry here (with a hard `until` expiry) to temporarily scale a
 * provider's budget; an entry whose `until` is in the past is inert.
 */
export const BUDGET_BOOSTS: Partial<Record<ProviderName, BudgetBoost>> = {}

/** The provider's boost multiplier at `now` — 1 when no boost is live. */
function getBoostMultiplier(provider: ProviderName, now: Date): number {
  const boost = BUDGET_BOOSTS[provider]
  if (!boost || now >= boost.until) return 1
  return boost.multiplier
}

/**
 * Daily budget descriptor for a provider on a given plan, or null when
 * unlimited (the `unlimited` plan, or a provider with no configured budget).
 * `pro` gets `PRO_BUDGET_MULTIPLIER`× the free budget; `free` gets the base.
 * Both are scaled again by any live `BUDGET_BOOSTS` entry.
 */
export function getProviderBudget(
  provider: ProviderName,
  plan: Plan = "free",
  now: Date = new Date()
): ProviderBudget | null {
  if (plan === "unlimited") return null
  const base = FREE_DAILY_BUDGETS[provider]
  if (!base) return null
  const multiplier =
    (plan === "pro" ? PRO_BUDGET_MULTIPLIER : 1) *
    getBoostMultiplier(provider, now)
  if (multiplier === 1) return base
  return { unit: base.unit, limit: base.limit * multiplier }
}

/**
 * Free models (mostly OpenCode's free tier) that must NOT count against the
 * shared-pool budget. They're still recorded in the ledger (so they appear in
 * overall totals), just flagged `freeModel=true` and excluded from shared sums.
 *
 * Matching is by tokscale's `model` id: this explicit set OR a `-free`/`:free`
 * suffix (the common convention) — so new free models are auto-caught.
 */
const FREE_MODELS: ReadonlySet<string> = new Set([
  "big-pickle",
  "deepseek-v4-flash-free",
  "nemotron-3-ultra-free",
])

/** Whether a model is free (excluded from shared-pool budgets). */
export function isFreeModel(model: string | null | undefined): boolean {
  if (!model) return false
  const m = model.toLowerCase()
  return FREE_MODELS.has(m) || m.endsWith("-free") || m.endsWith(":free")
}

/** Start of the current UTC day (budget window start for free users). */
export function getStartOfUtcDay(now: Date = new Date()): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  )
}

/** Next UTC midnight (when the daily budget resets). */
export function getNextUtcDayReset(now: Date = new Date()): Date {
  return new Date(getStartOfUtcDay(now).getTime() + 24 * 60 * 60 * 1000)
}

/** Start of the current ISO week (Monday 00:00 UTC) — Pro usage window. */
export function getStartOfUtcWeek(now: Date = new Date()): Date {
  const dayOfWeek = now.getUTCDay() // 0=Sun, 1=Mon, …
  const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1
  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() - daysSinceMonday
    )
  )
}

/** Next Monday 00:00 UTC. */
export function getNextUtcWeekReset(now: Date = new Date()): Date {
  return new Date(getStartOfUtcWeek(now).getTime() + 7 * 24 * 60 * 60 * 1000)
}
