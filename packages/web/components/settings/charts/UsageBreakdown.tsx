"use client"

import { useTheme } from "next-themes"
import { cn } from "@/lib/utils"
import { formatMetricValue } from "@/components/charts/chartFormatters"
import { singleSeriesColor } from "@/components/charts/palette"
import type { UsageBreakdownRow, UsageDimension } from "@/lib/db/user-usage"
import type { UsageMetricKey } from "./SpendPerDayChart"

/** How many rows to show before the rest collapse into a remainder line. */
const VISIBLE_ROWS = 8

interface UsageBreakdownProps {
  rows: UsageBreakdownRow[]
  dimension: UsageDimension
  metric: UsageMetricKey
  /** Narrow to this row, for the dimensions that can be scoped into. */
  onScopeTo?: (row: UsageBreakdownRow) => void
}

/**
 * Where the spend went, ranked — a bar per row, longest first.
 *
 * Horizontal because the labels are long (model ids, `owner/repo`, chat
 * names), and one hue for every bar because these are nominal categories:
 * shading them by value would re-encode the bar length as colour and spend the
 * only free channel on information the bar already carries. Every row is
 * directly labelled, so the numbers never depend on reading a bar against an
 * axis.
 */
export function UsageBreakdown({ rows, dimension, metric, onScopeTo }: UsageBreakdownProps) {
  const { resolvedTheme } = useTheme()
  const barColor = singleSeriesColor(resolvedTheme === "dark")

  const valueOf = (row: UsageBreakdownRow) =>
    metric === "credits" ? row.creditsUsd : row.tokens
  const fmt = (value: number) => formatMetricValue(metric === "credits" ? "cost" : "tokens", value)

  const ranked = [...rows].filter((r) => valueOf(r) > 0).sort((a, b) => valueOf(b) - valueOf(a))

  if (ranked.length === 0) {
    return (
      <div className="rounded-lg border border-border/60 px-4 py-8 text-center text-sm text-muted-foreground">
        {metric === "credits"
          ? "Nothing was charged to your balance in this range."
          : "No tokens recorded in this range."}
      </div>
    )
  }

  const shown = ranked.slice(0, VISIBLE_ROWS)
  const rest = ranked.slice(VISIBLE_ROWS)
  const max = valueOf(shown[0]) || 1
  const total = ranked.reduce((acc, r) => acc + valueOf(r), 0)

  return (
    <div>
      <ul className="divide-y divide-border/40">
        {shown.map((row) => {
          const value = valueOf(row)
          const share = total > 0 ? (value / total) * 100 : 0
          const scopeable = !!onScopeTo && (dimension === "repo" || dimension === "chat")
          const content = (
            <>
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate text-xs text-foreground" title={row.label}>
                  {row.label}
                </span>
                <span className="shrink-0 text-xs font-medium tabular-nums">{fmt(value)}</span>
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${(value / max) * 100}%`, backgroundColor: barColor }}
                  />
                </div>
                <span className="w-24 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums">
                  {share.toFixed(0)}% · {row.turns.toLocaleString()} turns
                </span>
              </div>
            </>
          )

          return (
            <li key={row.key}>
              {scopeable ? (
                <button
                  type="button"
                  onClick={() => onScopeTo?.(row)}
                  aria-label={`Show only ${row.label}`}
                  title={`Show only ${row.label}`}
                  className={cn(
                    "w-full rounded px-1 py-2.5 text-left transition-colors cursor-pointer",
                    "hover:bg-accent/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                  )}
                >
                  {content}
                </button>
              ) : (
                <div className="px-1 py-2.5">{content}</div>
              )}
            </li>
          )
        })}
      </ul>

      {rest.length > 0 && (
        <p className="mt-2 px-1 text-[11px] text-muted-foreground">
          + {rest.length} more, {fmt(rest.reduce((acc, r) => acc + valueOf(r), 0))} combined
        </p>
      )}
    </div>
  )
}
