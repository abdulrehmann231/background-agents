"use client"

import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { chartTooltipProps, lineTooltipCursor } from "./chartTooltip"
import { formatAxisDate, formatTooltipDate } from "./chartFormatters"
import { formatUnitValue, percentOf } from "@/lib/admin/usage-distribution"
import type { BudgetUnit } from "@/lib/server/usage-budgets"

// Shared = our spend, so it gets the "attention" colour; own-key is muted since
// it costs the platform nothing.
const SHARED_COLOR = "hsl(262, 83%, 58%)"
const USER_COLOR = "hsl(152, 60%, 50%)"

interface PoolSplitChartProps {
  data: Array<{ time: string; shared: number; user: number }>
  unit: BudgetUnit
}

/**
 * Shared-pool vs own-key usage over time.
 *
 * Deliberately ignores the dashboard's global pool filter — this chart *is* the
 * pool breakdown, and its whole job is showing how much of total demand lands on
 * credentials the platform pays for.
 */
export function PoolSplitChart({ data, unit }: PoolSplitChartProps) {
  const fmt = (v: number) => formatUnitValue(unit, v)
  const sharedTotal = data.reduce((acc, d) => acc + d.shared, 0)
  const userTotal = data.reduce((acc, d) => acc + d.user, 0)
  const total = sharedTotal + userTotal
  const hasData = total > 0

  if (!hasData) {
    return (
      <div className="flex h-[250px] items-center justify-center text-muted-foreground text-sm">
        No usage recorded in this range
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="h-[250px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis
              dataKey="time"
              tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              tickFormatter={formatAxisDate}
              axisLine={{ stroke: "hsl(var(--border))" }}
              tickLine={{ stroke: "hsl(var(--border))" }}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              axisLine={{ stroke: "hsl(var(--border))" }}
              tickLine={{ stroke: "hsl(var(--border))" }}
              width={50}
              tickFormatter={(v) => fmt(Number(v))}
            />
            <Tooltip
              {...chartTooltipProps}
              cursor={lineTooltipCursor}
              labelFormatter={(label) => formatTooltipDate(label)}
              formatter={(value) => fmt(Number(value))}
              isAnimationActive={false}
            />
            <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} itemSorter={null} />
            <Area
              type="monotone"
              dataKey="shared"
              name="Shared pool (our spend)"
              stackId="1"
              stroke={SHARED_COLOR}
              fill={SHARED_COLOR}
              fillOpacity={0.6}
              isAnimationActive={false}
            />
            <Area
              type="monotone"
              dataKey="user"
              name="Own key (their spend)"
              stackId="1"
              stroke={USER_COLOR}
              fill={USER_COLOR}
              fillOpacity={0.6}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <p className="text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{fmt(sharedTotal)}</span> on our
        pool ({percentOf(sharedTotal, total).toFixed(0)}% of total),{" "}
        <span className="font-medium text-foreground">{fmt(userTotal)}</span> on users&apos;
        own keys.
      </p>
    </div>
  )
}
