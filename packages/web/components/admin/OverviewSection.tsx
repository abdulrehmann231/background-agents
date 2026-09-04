"use client"

import {
  Users,
  MessageSquare,
  Clock,
  Wallet,
  KeyRound,
  BarChart3,
} from "lucide-react"
import { UserGrowthChart } from "./charts/UserGrowthChart"
import { MessagesByModelChart } from "./charts/MessagesByModelChart"
import { HourlyActivityChart } from "./charts/HourlyActivityChart"
import { DailyMessagesChatsChart } from "./charts/DailyMessagesChatsChart"
import { PoolSplitChart } from "./charts/PoolSplitChart"
import { UsageByKeyChart } from "./charts/UsageByKeyChart"
import { MessageValueHistogramChart } from "./charts/MessageValueHistogramChart"
import { UsageFilterBar } from "./UsageFilterBar"
import { DashboardFilterBar } from "./DashboardFilterBar"
import { cn } from "@/lib/utils"
import type {
  StatsTimeRange,
  StatsPool,
  UsageProvider,
  UsageMetric,
  UsageRange,
} from "@/lib/query/hooks"
import { metricLabel, type StatsMetric } from "./charts/chartFormatters"
import { COST_PROVIDERS, BILLED_PROVIDERS } from "./constants"
import type { useAdminStatsQuery, useUsageDistributionQuery } from "@/lib/query/hooks"

interface OverviewSectionProps {
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

export function OverviewSection({
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
}: OverviewSectionProps) {
  const weeklyActiveUsers = statsQuery.data?.weeklyActiveUsers ?? []
  const hourly = statsQuery.data?.hourly ?? []
  const series = statsQuery.data?.series ?? []
  const byAgent = statsQuery.data?.byAgent ?? []
  const byModel = statsQuery.data?.byModel ?? []
  const isHourly = globalTimeRange === "24h"
  const metricName = metricLabel(metric)
  const usage = usageQuery.data

  return (
    <>
      {/* Global Time Range Selector */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold md:text-xl">Overview</h2>
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

      {/* Charts Grid */}
      <section className="grid gap-4 md:gap-6 lg:grid-cols-2">
        <div className="rounded-xl border bg-card p-4 md:p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-500/10">
              <MessageSquare className="h-4 w-4 text-purple-500" />
            </div>
            <h3 className="font-medium">
              {metric === "messages"
                ? `${isHourly ? "Hourly" : "Daily"} Messages & Conversations`
                : `${metricName} over time`}
            </h3>
          </div>
          <DailyMessagesChatsChart data={series} metric={metric} isHourly={isHourly} />
        </div>

        <div className="rounded-xl border bg-card p-4 md:p-6 shadow-sm">
          <MessagesByModelChart
            agentData={byAgent}
            modelData={byModel}
            metric={metric}
            metricName={metricName}
            isHourly={isHourly}
          />
        </div>

        <div className="rounded-xl border bg-card p-4 md:p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-500/10">
              <Users className="h-4 w-4 text-green-500" />
            </div>
            <h3 className="font-medium">Weekly Active Users</h3>
          </div>
          <UserGrowthChart data={weeklyActiveUsers} />
        </div>

        <div className="rounded-xl border bg-card p-4 md:p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-pink-500/10">
              <Clock className="h-4 w-4 text-pink-500" />
            </div>
            <h3 className="font-medium">
              {metric === "messages" ? "Peak Activity Hours" : `${metricName} by Hour`}
            </h3>
          </div>
          <HourlyActivityChart data={hourly} metric={metric} />
        </div>
      </section>

      {/* Shared pool & usage */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <div>
          <h2 className="text-lg font-semibold md:text-xl">Shared pool &amp; usage</h2>
          <p className="text-xs text-muted-foreground">
            Where our credential spend goes
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

      <section className="grid gap-4 md:gap-6 lg:grid-cols-2">
        <div className="rounded-xl border bg-card p-4 md:p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-500/10">
              <Wallet className="h-4 w-4 text-teal-500" />
            </div>
            <h3 className="font-medium">Our pool vs own key</h3>
          </div>
          {usageQuery.isLoading ? (
            <div className="h-[250px] animate-pulse rounded bg-muted/50" />
          ) : (
            <PoolSplitChart
              data={usage?.poolSplit[effectiveUsageMetric] ?? []}
              metric={effectiveUsageMetric}
            />
          )}
        </div>

        {usageProvider === "opencode" && (
          <div className="rounded-xl border bg-card p-4 md:p-6 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-500/10">
                <KeyRound className="h-4 w-4 text-orange-500" />
              </div>
              <h3 className="font-medium">OpenCode usage by key</h3>
            </div>
            {usageQuery.isLoading ? (
              <div className="h-[250px] animate-pulse rounded bg-muted/50" />
            ) : (
              <UsageByKeyChart
                data={usage?.byKey[effectiveUsageMetric] ?? []}
                keyIds={usage?.keyIds ?? []}
                metric={effectiveUsageMetric}
              />
            )}
          </div>
        )}

        <div
          className={cn(
            "rounded-xl border bg-card p-4 md:p-6 shadow-sm",
            usageProvider === "opencode" && "lg:col-span-2"
          )}
        >
          <div className="mb-4 flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-500/10">
              <BarChart3 className="h-4 w-4 text-rose-500" />
            </div>
            <h3 className="font-medium">
              {effectiveUsageMetric === "cost" ? "Cost" : "Tokens"} per message
            </h3>
          </div>
          {usageQuery.isLoading ? (
            <div className="h-[250px] animate-pulse rounded bg-muted/50" />
          ) : (
            <MessageValueHistogramChart
              data={usage?.messageHistogram[effectiveUsageMetric] ?? []}
              metric={effectiveUsageMetric}
            />
          )}
        </div>
      </section>
    </>
  )
}
