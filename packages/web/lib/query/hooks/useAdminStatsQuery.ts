"use client"

import { useQuery } from "@tanstack/react-query"
import { useSession } from "next-auth/react"
import { queryKeys } from "../keys"
import { adminRetry, fetchAdminJson } from "./adminQuery"
import type { StatsMetric } from "@/components/admin/charts/chartFormatters"

export type StatsTimeRange = "24h" | "7d" | "30d" | "all"
export type { StatsMetric }

/**
 * Which credential pool the figures describe. "shared" is the platform's own
 * spend, "user" is spend on users' own keys, "all" is both. Ignored by the
 * server for the "messages" metric (ActivityLog has no pool dimension).
 */
export type StatsPool = "shared" | "user" | "all"

interface AdminStats {
  range: StatsTimeRange
  metric: StatsMetric
  pool: StatsPool
  weeklyActiveUsers: Array<{
    date: string
    count: number
  }>
  // Top users by the selected metric. `primary` is the metric value;
  // `secondary` is the conversation count for the "messages" metric, else null.
  topUsers: Array<{
    name: string
    image?: string | null
    primary: number
    secondary: number | null
  }>
  // By-hour distribution, valued by the selected metric.
  hourly: Array<{
    hour: number
    value: number
  }>
  // Over-time series (hourly for 24h, bucketed otherwise). `value` is the
  // selected metric; `value2` is the conversation count for "messages", else null.
  series: Array<{
    time: string
    value: number
    value2: number | null
  }>
  byAgent: Array<Record<string, number | string>>
  byModel: Array<Record<string, number | string>>
}

async function fetchAdminStats(
  range: StatsTimeRange,
  excludeAdmins: boolean,
  metric: StatsMetric,
  pool: StatsPool
): Promise<AdminStats> {
  return fetchAdminJson<AdminStats>(
    `/api/admin/stats?range=${range}&excludeAdmins=${excludeAdmins}&metric=${metric}&pool=${pool}`,
    "stats"
  )
}

export function useAdminStatsQuery(
  range: StatsTimeRange = "7d",
  excludeAdmins = true,
  metric: StatsMetric = "tokens",
  pool: StatsPool = "shared"
) {
  const { status } = useSession()
  const isAuthenticated = status === "authenticated"

  return useQuery({
    queryKey: queryKeys.admin.stats(range, excludeAdmins, metric, pool),
    queryFn: () => fetchAdminStats(range, excludeAdmins, metric, pool),
    enabled: isAuthenticated,
    staleTime: 30 * 1000, // 30 seconds
    retry: adminRetry,
  })
}
