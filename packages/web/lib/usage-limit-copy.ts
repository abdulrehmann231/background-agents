import type { Plan } from "@/lib/server/usage-budgets"
import { fmtBalance } from "@/lib/format"

export type LimitUpgradeTarget = "pro" | "unlimited"

export interface LimitUpgradeCopy {
  targetPlan: LimitUpgradeTarget
  title: string
  description: string
}

const UNLIMITED_UPGRADE_COPY: LimitUpgradeCopy = {
  targetPlan: "unlimited",
  title: "Upgrade to Unlimited",
  description: "Unlimited usage on all shared pools and priority support",
}

export function isPlan(value: unknown): value is Plan {
  return value === "free" || value === "pro" || value === "unlimited"
}

/**
 * The upgrade to offer from the out-of-credits dialog.
 *
 * Free and Pro are gated identically on credits now (see lib/db/usage-limit),
 * so a Pro upgrade would not actually clear this block — only `unlimited`
 * bypasses the credit gate entirely, so it's the only upgrade worth offering
 * here, for either plan.
 */
export function getLimitUpgradeCopy(plan: Plan | undefined): LimitUpgradeCopy | null {
  if (plan === "unlimited") return null
  return UNLIMITED_UPGRADE_COPY
}

/**
 * The message shown when a user has nothing left to spend.
 *
 * Gating is purely credit-based now (see lib/db/usage-limit): Free and Pro are
 * treated identically, and there is no separate free daily tier to fall back
 * on, so this is always about credits.
 *
 * Deliberately names no provider: the balance is pooled, so "your Claude limit"
 * was both wrong and confusing once the same allowance covered Gemini and
 * OpenCode. Free models are called out because they genuinely still work — they
 * never draw down the balance — and that is the most useful thing a blocked user
 * can be told.
 *
 * Topping up leads the list of next steps now that it exists: it is the only
 * one the user can act on immediately and alone. Adding an API key means
 * having one.
 */
export function formatUsageLimitMessage({
  creditBalance = 0,
}: {
  /**
   * Purchased credits in USD. Negative when the turn that emptied them
   * overshot — a cost is only known once the turn has run.
   */
  creditBalance?: number
}): string {
  // A deficit is the one case worth calling out specifically: the amount to
  // clear is more than "zero", so say so plainly.
  if (creditBalance < 0) {
    return (
      `Your last turn ran ${fmtBalance(Math.abs(creditBalance))} past your credits. ` +
      `Top up to clear it, add your own API key, or switch to a free model.`
    )
  }

  return (
    "You're out of credits. Top up to continue, add your own API key, " +
    "or switch to a free model."
  )
}
