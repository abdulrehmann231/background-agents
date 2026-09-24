"use client"

import { useMemo } from "react"
import { useTheme } from "next-themes"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts"
import { chartTooltipProps, barTooltipCursor } from "@/components/charts/chartTooltip"
import { formatAxisDate, formatMetricValue, formatTooltipDate } from "@/components/charts/chartFormatters"
import { seriesColor, slotColor, OTHER_KEY } from "@/components/charts/palette"
import type { UsageDayPoint, UsageDimension, UsageSeries } from "@/lib/db/user-usage"

/** Which measure the chart is drawn in. */
export type UsageMetricKey = "credits" | "tokens"

/** Map onto the shared formatter's vocabulary. */
function formatValue(metric: UsageMetricKey, value: number): string {
  return formatMetricValue(metric === "credits" ? "cost" : "tokens", value)
}

/** One row per day, with a numeric column per drawn series. */
type ChartRow = { date: string } & Record<string, number | string>

interface SpendPerDayChartProps {
  daily: UsageDayPoint[]
  /** Ranked and already folded by the server, longest-running first. */
  series: UsageSeries[]
  dimension: UsageDimension
  metric: UsageMetricKey
}

/**
 * Daily spend (or tokens), stacked by whatever dimension is selected — agent,
 * model, repo or chat.
 *
 * Stacked rather than grouped because the day's total is read first and the
 * split second. Agents colour from a fixed map so one keeps its hue whatever
 * else is on screen; the other dimensions are unbounded and have no such map,
 * so they take slots by rank (see slotColor).
 */
export function SpendPerDayChart({ daily, series, dimension, metric }: SpendPerDayChartProps) {
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === "dark"
  const field = metric === "credits" ? "credits" : "tokens"

  const colorAt = (key: string, index: number) => {
    if (key === OTHER_KEY) return seriesColor(OTHER_KEY, isDark)
    return dimension === "agent" ? seriesColor(key, isDark) : slotColor(index, isDark)
  }
  const labels = useMemo(
    () => new Map(series.map((entry) => [entry.key, entry.label])),
    [series]
  )
  const labelOf = (key: string) => labels.get(key) ?? key

  const keys = useMemo(() => series.map((entry) => entry.key), [series])

  const rows = useMemo<ChartRow[]>(
    () =>
      daily.map((day) => {
        const row: ChartRow = { date: day.date }
        for (const key of keys) {
          const value = day[field][key]
          if (value) row[key] = value
        }
        return row
      }),
    [daily, keys, field]
  )

  // Which series sits on top of each day's stack — that is the bar whose end
  // gets the rounded cap, so the rounding follows the data rather than whichever
  // series happens to be drawn last.
  const topSeriesPerRow = useMemo(
    () =>
      rows.map((row) => {
        for (let i = keys.length - 1; i >= 0; i--) {
          if ((row[keys[i]] as number ?? 0) > 0) return keys[i]
        }
        return null
      }),
    [rows, keys]
  )

  const total = rows.reduce(
    (acc, row) => acc + keys.reduce((sum, key) => sum + (row[key] as number ?? 0), 0),
    0
  )

  if (total <= 0) {
    return (
      <div className="flex h-[220px] items-center justify-center rounded-lg border border-border/60 text-sm text-muted-foreground">
        {metric === "credits"
          ? "No credits spent in this range"
          : "No tokens recorded in this range"}
      </div>
    )
  }

  return (
    <div>
      <div className="h-[220px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--border)" strokeOpacity={0.5} vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={formatAxisDate}
              interval="preserveStartEnd"
              minTickGap={24}
              tickLine={false}
              axisLine={{ stroke: "var(--border)" }}
              tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            />
            <YAxis
              width={52}
              tickFormatter={(v: number) => formatValue(metric, v)}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            />
            <Tooltip
              cursor={barTooltipCursor}
              content={(props) => (
                <StackTooltip {...props} metric={metric} labelOf={labelOf} />
              )}
            />
            {keys.map((key, seriesIndex) => (
              <Bar key={key} dataKey={key} stackId="spend" isAnimationActive={false}>
                {rows.map((row, i) => (
                  <Cell
                    key={row.date}
                    fill={colorAt(key, seriesIndex)}
                    // A surface-coloured hairline reads as a gap between
                    // segments without shrinking the bars themselves.
                    stroke="var(--background)"
                    strokeWidth={1}
                    // Round the data end only, so the stack stays anchored to
                    // the baseline. Recharts merges Cell props into the
                    // underlying Rectangle, which takes a per-corner tuple —
                    // but Cell itself is typed as plain SVG props, where
                    // radius is a scalar. Hence the cast.
                    radius={
                      (topSeriesPerRow[i] === key ? [3, 3, 0, 0] : 0) as unknown as number
                    }
                  />
                ))}
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* A legend, not just colour: three of the light-mode series steps sit
          under 3:1 against the surface, so identity has to be spelled out. */}
      {keys.length > 1 && (
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
          {keys.map((key, seriesIndex) => (
            <li
              key={key}
              className="flex max-w-64 items-center gap-1.5 text-xs text-muted-foreground"
            >
              <span
                aria-hidden
                className="h-2 w-2 shrink-0 rounded-[2px]"
                style={{ backgroundColor: colorAt(key, seriesIndex) }}
              />
              <span className="truncate" title={labelOf(key)}>
                {labelOf(key)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Tooltip listing only the series that actually ran that day, plus the total. */
function StackTooltip({
  active,
  payload,
  label,
  metric,
  labelOf,
}: TooltipContentProps & { metric: UsageMetricKey; labelOf: (key: string) => string }) {
  if (!active || !payload?.length) return null
  const entries = payload.filter((p) => Number(p.value ?? 0) > 0)
  if (entries.length === 0) return null
  const total = entries.reduce((acc, p) => acc + Number(p.value ?? 0), 0)

  return (
    <div style={chartTooltipProps.contentStyle}>
      <p style={chartTooltipProps.labelStyle}>{formatTooltipDate(label ?? "")}</p>
      {entries.map((entry) => (
        <div
          key={String(entry.dataKey)}
          style={{ ...chartTooltipProps.itemStyle, display: "flex", alignItems: "center", gap: 6 }}
        >
          <span
            aria-hidden
            style={{
              width: 8,
              height: 8,
              borderRadius: 2,
              backgroundColor: entry.color,
              flexShrink: 0,
            }}
          />
          <span style={{ flex: 1 }}>{labelOf(String(entry.dataKey))}</span>
          <span style={{ fontWeight: 600 }}>{formatValue(metric, Number(entry.value ?? 0))}</span>
        </div>
      ))}
      {entries.length > 1 && (
        <div
          style={{
            ...chartTooltipProps.itemStyle,
            display: "flex",
            gap: 12,
            marginTop: 4,
            paddingTop: 4,
            borderTop: "1px solid var(--tooltip-border, #e5e7eb)",
            fontWeight: 600,
          }}
        >
          <span style={{ flex: 1 }}>Total</span>
          <span>{formatValue(metric, total)}</span>
        </div>
      )}
    </div>
  )
}
