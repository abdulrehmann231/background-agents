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
 * The message shown when the daily allowance runs out.
 *
 * Deliberately names no provider: the balance is pooled, so "your Claude limit"
 * was both wrong and confusing once the same allowance covered Gemini and
 * OpenCode. Free models are called out because they genuinely still work — they
 * never draw down the balance — and that is the most useful thing a blocked user
 * can be told.
 */
export function formatUsageLimitMessage({
  plan,
  limit,
}: {
  plan: Plan
  limit: number
}): string {
  const nextStep =
    plan === "free"
      ? "Upgrade to Pro for twice the daily balance, upgrade to Unlimited for uncapped usage, " +
        "add your own API key, or switch to a free model."
      : plan === "pro"
        ? "Upgrade to Unlimited for uncapped usage, add your own API key, " +
          "or switch to a free model."
        : "Add your own API key to continue."

  return `Daily limit reached (${fmtBalance(limit)}). ${nextStep}`
}
