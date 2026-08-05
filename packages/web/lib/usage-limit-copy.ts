import type { ProviderName } from "@background-agents/common"
import type { BudgetUnit, Plan } from "@/lib/server/usage-budgets"

export type LimitUpgradeTarget = "pro" | "unlimited"

export interface LimitUpgradeCopy {
  targetPlan: LimitUpgradeTarget
  title: string
  description: string
}

const FREE_UPGRADE_COPY: LimitUpgradeCopy = {
  targetPlan: "pro",
  title: "Upgrade to Pro",
  description: "Higher daily limits on all shared pools and priority support",
}

const PRO_UPGRADE_COPY: LimitUpgradeCopy = {
  targetPlan: "unlimited",
  title: "Upgrade to Unlimited",
  description: "Unlimited usage on all shared pools and priority support",
}

const PROVIDER_LABELS: Partial<Record<ProviderName, string>> = {
  claude: "Claude",
  gemini: "Gemini",
  opencode: "OpenCode",
}

export function isPlan(value: unknown): value is Plan {
  return value === "free" || value === "pro" || value === "unlimited"
}

export function getLimitUpgradeCopy(plan: Plan | undefined): LimitUpgradeCopy | null {
  if (plan === "unlimited") return null
  if (plan === "pro") return PRO_UPGRADE_COPY
  return FREE_UPGRADE_COPY
}

export function formatUsageLimitMessage({
  plan,
  provider,
  unit,
  limit,
}: {
  plan: Plan
  provider: ProviderName
  unit: BudgetUnit
  limit: number
}): string {
  const providerLabel = PROVIDER_LABELS[provider]
    ?? provider.charAt(0).toUpperCase() + provider.slice(1)
  const allowance =
    unit === "tokens"
      ? `${limit.toLocaleString("en-US")} tokens`
      : unit === "cost"
        ? `$${limit.toFixed(2)}`
        : `${limit.toLocaleString("en-US")} messages`

  const nextStep =
    plan === "free"
      ? "Upgrade to Pro for higher daily limits, upgrade to Unlimited for unlimited usage, " +
        `or add your own ${providerLabel} key.`
      : plan === "pro"
        ? `Upgrade to Unlimited for unlimited usage, or add your own ${providerLabel} key.`
        : `Add your own ${providerLabel} key to continue.`

  return `Daily ${providerLabel} limit reached (${allowance}). ${nextStep}`
}
