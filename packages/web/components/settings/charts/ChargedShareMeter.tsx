"use client"

import { useTheme } from "next-themes"
import { fmtTokens } from "@/lib/format"
import { singleSeriesColor } from "@/components/charts/palette"
import type { UsageTokenMix } from "@/lib/db/user-usage"

/**
 * What share of the window's tokens actually reached the balance.
 *
 * A meter rather than a two-slice pie: this is one ratio against a whole, and
 * the number is the point. It exists because "Spent" alone is misleading for
 * anyone running their own keys or free models — plenty of work can happen
 * without costing a cent, and without this the tab would imply their usage was
 * small rather than free.
 */
export function ChargedShareMeter({ mix }: { mix: UsageTokenMix }) {
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === "dark"

  const total = mix.totalTokens
  const charged = Math.min(mix.chargedTokens, total)
  const free = Math.max(total - charged, 0)
  const pct = total > 0 ? (charged / total) * 100 : 0

  if (total <= 0) {
    return <p className="text-xs text-muted-foreground">No tokens recorded in this range.</p>
  }

  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-semibold tabular-nums leading-none">
          {pct < 1 && pct > 0 ? "<1" : Math.round(pct)}%
        </span>
        <span className="text-xs text-muted-foreground">charged to your balance</span>
      </div>

      <div
        className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-muted"
        role="meter"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Share of tokens charged to your balance"
      >
        <div
          className="h-full rounded-full"
          style={{ width: `${pct}%`, backgroundColor: singleSeriesColor(isDark) }}
        />
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        {fmtTokens(charged)} charged · {fmtTokens(free)} on your own keys or free models
      </p>
    </div>
  )
}
