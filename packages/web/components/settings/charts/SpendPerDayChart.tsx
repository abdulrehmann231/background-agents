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
import {
  foldSeries,
  seriesColor,
  providerSeriesLabel,
  OTHER_KEY,
} from "@/components/charts/palette"
import type { UsageDayPoint } from "@/lib/db/user-usage"

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
  /** Providers present in the window, already ranked. */
  providers: string[]
  metric: UsageMetricKey
}

/**
 * Daily spend (or tokens), stacked by the agent that incurred it.
 *
 * Stacked rather than grouped because the day's total is the thing being read
 * first and the split second. Colour comes from the fixed agent→slot map, so
 * an agent keeps its hue no matter which other agents happen to be present.
 */
export function SpendPerDayChart({ daily, providers, metric }: SpendPerDayChartProps) {
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === "dark"
  const colorOf = (provider: string) => seriesColor(provider, isDark)
  const field = metric === "credits" ? "credits" : "tokens"

  // Rank and fold before drawing: past eight series a ninth colour would be
  // indistinguishable under CVD, so the tail becomes a single grey "Other".
  const series = useMemo(() => {
    const weightOf = (provider: string) =>
      daily.reduce((acc, day) => acc + (day[field][provider] ?? 0), 0)
    return foldSeries(providers, weightOf)
  }, [daily, providers, field])

  const rows = useMemo<ChartRow[]>(() => {
    const drawn = new Set(series)
    return daily.map((day) => {
      const row: ChartRow = { date: day.date }
      let other = 0
      for (const [provider, value] of Object.entries(day[field])) {
        if (drawn.has(provider)) row[provider] = (row[provider] as number ?? 0) + value
        else other += value
      }
      if (drawn.has(OTHER_KEY) && other > 0) row[OTHER_KEY] = other
      return row
    })
  }, [daily, series, field])

  // Which series sits on top of each day's stack — that is the bar whose end
  // gets the rounded cap, so the rounding follows the data rather than whichever
  // series happens to be drawn last.
  const topSeriesPerRow = useMemo(
    () =>
      rows.map((row) => {
        for (let i = series.length - 1; i >= 0; i--) {
          if ((row[series[i]] as number ?? 0) > 0) return series[i]
        }
        return null
      }),
    [rows, series]
  )

  const total = rows.reduce(
    (acc, row) => acc + series.reduce((s, key) => s + (row[key] as number ?? 0), 0),
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
              content={(props) => <StackTooltip {...props} metric={metric} />}
            />
            {series.map((key) => (
              <Bar key={key} dataKey={key} stackId="spend" isAnimationActive={false}>
                {rows.map((row, i) => (
                  <Cell
                    key={row.date}
                    fill={colorOf(key)}
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
      {series.length > 1 && (
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
          {series.map((key) => (
            <li key={key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span
                aria-hidden
                className="h-2 w-2 shrink-0 rounded-[2px]"
                style={{ backgroundColor: colorOf(key) }}
              />
              {providerSeriesLabel(key)}
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
}: TooltipContentProps & { metric: UsageMetricKey }) {
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
          <span style={{ flex: 1 }}>{providerSeriesLabel(String(entry.dataKey))}</span>
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
