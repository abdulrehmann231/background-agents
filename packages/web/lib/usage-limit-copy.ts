import type { Plan } from "@/lib/server/usage-budgets"
import { fmtBalance } from "@/lib/format"

export type LimitUpgradeTarget = "pro" | "unlimited"

export interface LimitUpgradeCopy {
  targetPlan: LimitUpgradeTarget
  title: string
  description: string
}

const FREE_UPGRADE_COPY: LimitUpgradeCopy = {
  targetPlan: "pro",
  title: "Upgrade to Pro",
  description: "Twice the daily balance and priority support",
}

const PRO_UPGRADE_COPY: LimitUpgradeCopy = {
  targetPlan: "unlimited",
  title: "Upgrade to Unlimited",
  description: "Unlimited usage on all shared pools and priority support",
}

export function isPlan(value: unknown): value is Plan {
  return value === "free" || value === "pro" || value === "unlimited"
}

export function getLimitUpgradeCopy(plan: Plan | undefined): LimitUpgradeCopy | null {
  if (plan === "unlimited") return null
  if (plan === "pro") return PRO_UPGRADE_COPY
  return FREE_UPGRADE_COPY
}

/**
 * The message shown when a user has nothing left to spend.
 *
 * Deliberately names no provider: the balance is pooled, so "your Claude limit"
 * was both wrong and confusing once the same allowance covered Gemini and
 * OpenCode. Free models are called out because they genuinely still work — they
 * never draw down the balance — and that is the most useful thing a blocked user
 * can be told.
 *
 * Topping up leads the list of next steps now that it exists: it is the only
 * one the user can act on immediately and alone. Upgrading still means emailing
 * a human, and adding an API key means having one.
 */
export function formatUsageLimitMessage({
  plan,
  limit,
  creditBalance = 0,
}: {
  plan: Plan
  limit: number
  /**
   * Purchased credits in USD. Negative when the turn that emptied them
   * overshot — a cost is only known once the turn has run.
   */
  creditBalance?: number
}): string {
  // A deficit is the one case where topping up is not merely an option: nothing
  // will run until it is cleared, so say that plainly instead of offering a
  // menu of upgrades that would not help either.
  if (creditBalance < 0) {
    return (
      `Daily limit reached (${fmtBalance(limit)}), and your last turn ran ` +
      `${fmtBalance(Math.abs(creditBalance))} past your credits. Top up to clear it, ` +
      `add your own API key, or switch to a free model.`
    )
  }

  const nextStep =
    plan === "free"
      ? "Top up credits, upgrade to Pro for twice the daily balance, " +
        "add your own API key, or switch to a free model."
      : plan === "pro"
        ? "Top up credits, upgrade to Unlimited for uncapped usage, " +
          "add your own API key, or switch to a free model."
        : "Add your own API key to continue."

  return `Daily limit reached (${fmtBalance(limit)}). ${nextStep}`
}
