"use client"

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { chartTooltipProps, barTooltipCursor } from "./chartTooltip"
import { formatMetricValue } from "./chartFormatters"
import type { MessageHistogramBucket, UsageMetric } from "@/lib/query/hooks"

const BAR_COLOR = "hsl(262, 83%, 58%)"

interface MessageValueHistogramChartProps {
  data: MessageHistogramBucket[]
  metric: UsageMetric
}

/**
 * Distribution of per-message tokens/cost for the selected provider — how
 * heavy a typical turn is, and whether a handful of outliers are pulling the
 * average up. Bucketed server-side into equal-width bins from 0 to the
 * heaviest single message seen in the range.
 */
export function MessageValueHistogramChart({ data, metric }: MessageValueHistogramChartProps) {
  const totalMessages = data.reduce((acc, b) => acc + b.count, 0)

  if (totalMessages === 0) {
    return (
      <div className="flex h-[250px] items-center justify-center text-muted-foreground text-sm">
        No messages recorded in this range
      </div>
    )
  }

  const chartData = data.map((b) => ({
    ...b,
    label: `${formatMetricValue(metric, b.bucketStart)}–${formatMetricValue(metric, b.bucketEnd)}`,
  }))

  return (
    <div className="h-[250px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
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
          />
          <Tooltip
            {...chartTooltipProps}
            cursor={barTooltipCursor}
            labelFormatter={(label) => `${label} per message`}
            formatter={(value) => [`${value}`, "Messages"]}
          />
          <Bar dataKey="count" fill={BAR_COLOR} radius={[3, 3, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
