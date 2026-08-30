/**
 * Per-provider daily budgets for the shared credential pools.
 *
 * Budgets scale by plan: `free` gets the base daily budget, `pro` gets 2× that
 * budget (still daily), and `unlimited` is uncapped. The budget *unit* differs
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
 * Sizing the Claude budget, for a pool of ~200 users behind one shared
 * subscription. A typical Claude Code turn (~1k uncached input, ~1.5k output,
 * ~60k cache read, ~8k cache write) costs roughly:
 *
 *   Haiku 4.5   ~$0.024      Sonnet 5   ~$0.049
 *   Opus 5      ~$0.12       Fable 5    ~$0.25
 *
 * At $0.50/day a free user gets ~20 Haiku, ~10 Sonnet, ~4 Opus or ~2 Fable
 * turns; Pro doubles that. Worst case (all 200 users maxing out daily) is
 * $100/day, far past what one subscription covers — but that shape never
 * happens: at a realistic ~10% daily-active rate spending ~60% of the cap,
 * it lands near $6/day, comfortably inside a Max-tier subscription with room
 * for the tail. Revisit once the ledger has enough history to replace those two
 * assumptions with measurements, and consider a pool-wide daily ceiling before
 * the user count grows much past 200.
 */
const FREE_DAILY_BUDGETS: Partial<Record<ProviderName, ProviderBudget>> = {
  claude: { unit: "cost", limit: 0.5 },
  // TODO(token-budgets): tune these two against the ledger, as above.
  opencode: { unit: "cost", limit: 0.5 },
  gemini: { unit: "messages", limit: 100 },
}

/**
 * Daily budget descriptor for a provider on a given plan, or null when
 * unlimited (the `unlimited` plan, or a provider with no configured budget).
 * `pro` gets `PRO_BUDGET_MULTIPLIER`× the free budget; `free` gets the base.
 */
export function getProviderBudget(
  provider: ProviderName,
  plan: Plan = "free"
): ProviderBudget | null {
  if (plan === "unlimited") return null
  const base = FREE_DAILY_BUDGETS[provider]
  if (!base) return null
  if (plan === "pro") {
    return { unit: base.unit, limit: base.limit * PRO_BUDGET_MULTIPLIER }
  }
  return base
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
