"use client"

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { barTooltipCursor, chartTooltipProps } from "./chartTooltip"
import {
  buildHistogram,
  formatUnitValue,
  type Percentiles,
} from "@/lib/admin/usage-distribution"
import type { BudgetUnit } from "@/lib/server/usage-budgets"

interface UsageDistributionChartProps {
  /** One value per active user-day (idle days already excluded). */
  values: number[]
  unit: BudgetUnit
  stats: Percentiles
  /** Current free-tier daily budget, drawn as a reference line. */
  freeLimit: number | null
}

const BAR_COLOR = "hsl(262, 83%, 58%)"
// Bars at or beyond the current free limit — i.e. the user-days a limit at that
// level would already be cutting off.
const OVER_LIMIT_COLOR = "hsl(340, 82%, 52%)"

/**
 * Histogram of per-user-per-day shared-pool usage, on a log scale.
 *
 * This is the chart that answers "where should the cap go": each bar is a count
 * of active user-days in that usage band, so a candidate limit can be read off
 * directly against how much of the distribution sits above it.
 */
export function UsageDistributionChart({
  values,
  unit,
  stats,
  freeLimit,
}: UsageDistributionChartProps) {
  const fmt = (v: number) => formatUnitValue(unit, v)
  const buckets = buildHistogram(values, fmt)

  if (buckets.length === 0) {
    return (
      <div className="flex h-[250px] items-center justify-center text-center text-muted-foreground text-sm">
        No shared-pool usage recorded in this range
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="h-[250px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={buckets} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              axisLine={{ stroke: "hsl(var(--border))" }}
              tickLine={{ stroke: "hsl(var(--border))" }}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              axisLine={{ stroke: "hsl(var(--border))" }}
              tickLine={{ stroke: "hsl(var(--border))" }}
              width={40}
              allowDecimals={false}
              label={{
                value: "user-days",
                angle: -90,
                position: "insideLeft",
                style: { fontSize: 10, fill: "hsl(var(--muted-foreground))" },
              }}
            />
            <Tooltip
              {...chartTooltipProps}
              cursor={barTooltipCursor}
              formatter={(value) => [`${Number(value).toLocaleString()} user-days`, "Count"]}
              isAnimationActive={false}
            />
            {freeLimit != null && (
              <ReferenceLine
                x={buckets.find((b) => freeLimit >= b.min && freeLimit < b.max)?.label}
                stroke={OVER_LIMIT_COLOR}
                strokeDasharray="4 4"
                label={{
                  value: `free limit ${fmt(freeLimit)}`,
                  position: "top",
                  style: { fontSize: 10, fill: OVER_LIMIT_COLOR },
                }}
              />
            )}
            <Bar dataKey="count" isAnimationActive={false} radius={[3, 3, 0, 0]}>
              {buckets.map((b) => (
                <Cell
                  key={b.label}
                  fill={freeLimit != null && b.min >= freeLimit ? OVER_LIMIT_COLOR : BAR_COLOR}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Percentile summary — the numbers you'd actually set a limit from. */}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-5">
        {(
          [
            ["p50", stats.p50],
            ["p90", stats.p90],
            ["p99", stats.p99],
            ["max", stats.max],
            ["mean", stats.mean],
          ] as const
        ).map(([label, v]) => (
          <div key={label} className="rounded-md bg-muted/50 px-2 py-1.5">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="font-medium tabular-nums">{fmt(v)}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-muted-foreground">
        One sample per user per active day. Idle days are excluded — a daily cap
        only binds on days someone actually used the pool.
      </p>
    </div>
  )
}
