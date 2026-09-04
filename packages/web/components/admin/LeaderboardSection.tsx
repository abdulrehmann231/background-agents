"use client"

import { Trophy, Users } from "lucide-react"
import { TopUsersTable } from "./TopUsersTable"
import { UsageByUserTable } from "./UsageByUserTable"
import { UsageFilterBar } from "./UsageFilterBar"
import { DashboardFilterBar } from "./DashboardFilterBar"
import type {
  StatsTimeRange,
  StatsPool,
  UsageProvider,
  UsageMetric,
  UsageRange,
} from "@/lib/query/hooks"
import { metricLabel, type StatsMetric } from "./charts/chartFormatters"
import type { useAdminStatsQuery, useUsageDistributionQuery } from "@/lib/query/hooks"

interface LeaderboardSectionProps {
  globalTimeRange: StatsTimeRange
  onTimeRangeChange: (range: StatsTimeRange) => void
  includeAdmins: boolean
  onIncludeAdminsChange: (v: boolean | ((prev: boolean) => boolean)) => void
  metric: StatsMetric
  onMetricChange: (metric: StatsMetric) => void
  pool: StatsPool
  onPoolChange: (pool: StatsPool) => void
  poolFilterDisabled: boolean
  usageProvider: UsageProvider
  onUsageProviderChange: (provider: UsageProvider) => void
  usageMetric: UsageMetric
  onUsageMetricChange: (metric: UsageMetric) => void
  costSupported: boolean
  effectiveUsageMetric: UsageMetric
  costIsNotional: boolean
  usageRange: UsageRange
  statsQuery: ReturnType<typeof useAdminStatsQuery>
  usageQuery: ReturnType<typeof useUsageDistributionQuery>
}

export function LeaderboardSection({
  globalTimeRange,
  onTimeRangeChange,
  includeAdmins,
  onIncludeAdminsChange,
  metric,
  onMetricChange,
  pool,
  onPoolChange,
  poolFilterDisabled,
  usageProvider,
  onUsageProviderChange,
  usageMetric,
  onUsageMetricChange,
  costSupported,
  effectiveUsageMetric,
  costIsNotional,
  statsQuery,
  usageQuery,
}: LeaderboardSectionProps) {
  const topUsers = statsQuery.data?.topUsers ?? []
  const metricName = metricLabel(metric)
  const usage = usageQuery.data

  return (
    <>
      {/* Global Time Range Selector */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold md:text-xl">Leaderboard</h2>
        <DashboardFilterBar
          includeAdmins={includeAdmins}
          onIncludeAdminsChange={onIncludeAdminsChange}
          metric={metric}
          onMetricChange={onMetricChange}
          pool={pool}
          onPoolChange={onPoolChange}
          poolFilterDisabled={poolFilterDisabled}
          globalTimeRange={globalTimeRange}
          onTimeRangeChange={onTimeRangeChange}
        />
      </div>

      {/* Top Active Users */}
      <section className="grid gap-4 md:gap-6">
        <div className="rounded-xl border bg-card p-4 md:p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/10">
              <Trophy className="h-4 w-4 text-amber-500" />
            </div>
            <h3 className="font-medium">Top Users by {metricName}</h3>
          </div>
          <TopUsersTable
            data={topUsers}
            metric={metric}
            isLoading={statsQuery.isFetching}
          />
        </div>
      </section>

      {/* Usage by user */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <div>
          <h2 className="text-lg font-semibold md:text-xl">Usage by user</h2>
          <p className="text-xs text-muted-foreground">
            Per-user breakdown of shared pool usage
            {globalTimeRange === "all" && " · last 30 days"}
            {costIsNotional &&
              " · API-equivalent value on a flat subscription, not a bill"}
          </p>
        </div>
        <UsageFilterBar
          costSupported={costSupported}
          effectiveUsageMetric={effectiveUsageMetric}
          onUsageMetricChange={onUsageMetricChange}
          usageProvider={usageProvider}
          onUsageProviderChange={onUsageProviderChange}
        />
      </div>

      <section className="grid gap-4 md:gap-6">
        <div className="rounded-xl border bg-card p-4 md:p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500/10">
              <Users className="h-4 w-4 text-indigo-500" />
            </div>
            <h3 className="font-medium">Usage by user</h3>
          </div>
          <UsageByUserTable
            users={usage?.users ?? []}
            metric={effectiveUsageMetric}
            showCost={costSupported}
            isLoading={usageQuery.isLoading}
          />
        </div>
      </section>
    </>
  )
}
