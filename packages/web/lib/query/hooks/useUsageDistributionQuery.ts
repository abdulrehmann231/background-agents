"use client"

import { useQuery } from "@tanstack/react-query"
import { useSession } from "next-auth/react"
import { queryKeys } from "../keys"
import { adminRetry, fetchAdminJson } from "./adminQuery"
import type { UserDailyUsage } from "@/lib/admin/usage-distribution"
import type { BudgetUnit } from "@/lib/server/usage-budgets"

/** Providers that have a shared pool and a configured budget. */
export type UsageProvider = "claude" | "opencode" | "gemini"

/** The distribution view is day-bucketed, so it excludes the "all" range. */
export type UsageRange = "24h" | "7d" | "30d"

export interface UsageDistribution {
  range: UsageRange
  provider: UsageProvider
  /** Unit the provider's budget is denominated in (tokens | cost | messages). */
  unit: BudgetUnit
  /** Currently configured daily budgets, for reference lines on the charts. */
  currentLimits: { free: number | null; pro: number | null }
  /** Multiplier applied to the free budget for pro users (currently 2). */
  proMultiplier: number
  /** Day axis (ISO dates) that `perUser.daily` indexes into positionally. */
  days: string[]
  /** Shared-pool usage per user per day — the sample a limit would apply to. */
  perUser: UserDailyUsage[]
  /** Shared vs own-key usage over time. */
  poolSplit: Array<{ time: string; shared: number; user: number }>
  /** Per-key usage over time (OpenCode only; empty otherwise). */
  byKey: Array<Record<string, number | string>>
  /** Key fingerprints present in `byKey`, including "unattributed". */
  keyIds: string[]
}

async function fetchUsageDistribution(
  range: UsageRange,
  provider: UsageProvider,
  excludeAdmins: boolean
): Promise<UsageDistribution> {
  return fetchAdminJson<UsageDistribution>(
    `/api/admin/usage-distribution?range=${range}&provider=${provider}&excludeAdmins=${excludeAdmins}`,
    "usage distribution"
  )
}

export function useUsageDistributionQuery(
  range: UsageRange = "30d",
  provider: UsageProvider = "opencode",
  excludeAdmins = true
) {
  const { status } = useSession()
  const isAuthenticated = status === "authenticated"

  return useQuery({
    queryKey: queryKeys.admin.usageDistribution(range, provider, excludeAdmins),
    queryFn: () => fetchUsageDistribution(range, provider, excludeAdmins),
    enabled: isAuthenticated,
    staleTime: 60 * 1000,
    retry: adminRetry,
  })
}
