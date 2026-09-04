"use client"

import { cn } from "@/lib/utils"
import type { StatsTimeRange, StatsPool } from "@/lib/query/hooks"
import type { StatsMetric } from "@/components/admin/charts/chartFormatters"
import { METRIC_OPTIONS, POOL_OPTIONS, POOL_DISABLED_HINT } from "./constants"

interface DashboardFilterBarProps {
  includeAdmins: boolean
  onIncludeAdminsChange: (v: boolean | ((prev: boolean) => boolean)) => void
  metric: StatsMetric
  onMetricChange: (metric: StatsMetric) => void
  pool: StatsPool
  onPoolChange: (pool: StatsPool) => void
  poolFilterDisabled: boolean
  globalTimeRange: StatsTimeRange
  onTimeRangeChange: (range: StatsTimeRange) => void
}

export function DashboardFilterBar({
  includeAdmins,
  onIncludeAdminsChange,
  metric,
  onMetricChange,
  pool,
  onPoolChange,
  poolFilterDisabled,
  globalTimeRange,
  onTimeRangeChange,
}: DashboardFilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 sm:gap-3">
      {/* Include admins toggle */}
      <button
        type="button"
        role="switch"
        aria-checked={includeAdmins}
        onClick={() => onIncludeAdminsChange((v: boolean) => !v)}
        className={cn(
          "flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all sm:text-sm",
          includeAdmins
            ? "border-primary/30 bg-primary/10 text-primary"
            : "border-transparent bg-muted text-muted-foreground hover:text-foreground"
        )}
      >
        <span
          className={cn(
            "flex h-4 w-7 items-center rounded-full p-0.5 transition-colors",
            includeAdmins ? "bg-primary" : "bg-muted-foreground/30"
          )}
        >
          <span
            className={cn(
              "h-3 w-3 rounded-full bg-background transition-transform",
              includeAdmins ? "translate-x-3" : "translate-x-0"
            )}
          />
        </span>
        Include admins
      </button>

      {/* Metric selector */}
      <div className="flex gap-1 rounded-lg bg-muted p-1">
        {METRIC_OPTIONS.map((option) => (
          <button
            key={option.key}
            onClick={() => onMetricChange(option.key)}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-medium transition-all sm:px-4 sm:text-sm",
              metric === option.key
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      {/* Credential pool selector */}
      <div
        className={cn(
          "flex gap-1 rounded-lg bg-muted p-1",
          poolFilterDisabled && "opacity-50"
        )}
        title={poolFilterDisabled ? POOL_DISABLED_HINT : undefined}
      >
        {POOL_OPTIONS.map((option) => (
          <button
            key={option.key}
            onClick={() => onPoolChange(option.key)}
            disabled={poolFilterDisabled}
            title={poolFilterDisabled ? POOL_DISABLED_HINT : option.hint}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-medium transition-all sm:px-4 sm:text-sm",
              poolFilterDisabled && "cursor-not-allowed",
              !poolFilterDisabled && pool === option.key
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      {/* Time range buttons */}
      <div className="flex gap-1 rounded-lg bg-muted p-1">
        {(["24h", "7d", "30d", "all"] as const).map((range) => (
          <button
            key={range}
            onClick={() => onTimeRangeChange(range)}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-medium transition-all sm:px-4 sm:text-sm",
              globalTimeRange === range
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {range === "all" ? "All" : range}
          </button>
        ))}
      </div>
    </div>
  )
}
