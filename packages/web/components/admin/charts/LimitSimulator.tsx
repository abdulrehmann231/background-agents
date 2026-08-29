"use client"

import { useMemo, useState } from "react"
import { cn } from "@/lib/utils"
import {
  formatUnitValue,
  percentOf,
  simulateLimit,
  type UserDailyUsage,
} from "@/lib/admin/usage-distribution"
import type { BudgetUnit } from "@/lib/server/usage-budgets"

interface LimitSimulatorProps {
  /** Shared-pool usage per user per day — the sample a limit would apply to. */
  perUser: UserDailyUsage[]
  unit: BudgetUnit
  /** Currently configured free-tier daily budget, used as the initial value. */
  freeLimit: number | null
  /** Pro multiplier applied on top of the free budget (currently 2×). */
  proMultiplier: number
}

/** Step size for the numeric input, scaled to the unit's typical magnitude. */
function stepFor(unit: BudgetUnit): number {
  if (unit === "cost") return 0.05
  if (unit === "messages") return 1
  return 10_000
}

/**
 * Retrospective "what would this limit have done?" tool.
 *
 * Recomputes entirely client-side from the already-fetched per-user matrix, so
 * dragging the number is instant. The point is to replace the placeholder
 * budgets in usage-budgets.ts with values chosen against real usage.
 */
export function LimitSimulator({
  perUser,
  unit,
  freeLimit,
  proMultiplier,
}: LimitSimulatorProps) {
  const [limit, setLimit] = useState<number>(freeLimit ?? 0)

  const free = useMemo(() => simulateLimit(perUser, limit), [perUser, limit])
  const pro = useMemo(
    () => simulateLimit(perUser, limit * proMultiplier),
    [perUser, limit, proMultiplier]
  )

  const fmt = (v: number) => formatUnitValue(unit, v)
  const hasData = free.usersTotal > 0

  const isUnchanged = freeLimit != null && limit === freeLimit

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Free tier — daily limit</span>
          <input
            type="number"
            min={0}
            step={stepFor(unit)}
            value={limit}
            onChange={(e) => setLimit(Math.max(0, Number(e.target.value) || 0))}
            className="w-40 rounded-md border bg-background px-3 py-1.5 text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-primary/40"
          />
        </label>
        {freeLimit != null && (
          <button
            type="button"
            onClick={() => setLimit(freeLimit)}
            disabled={isUnchanged}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              isUnchanged
                ? "cursor-default bg-muted text-muted-foreground"
                : "bg-muted text-muted-foreground hover:text-foreground"
            )}
          >
            {isUnchanged ? `Current: ${fmt(freeLimit)}` : `Reset to ${fmt(freeLimit)}`}
          </button>
        )}
      </div>

      {!hasData ? (
        <div className="rounded-lg bg-muted/50 px-4 py-6 text-center text-sm text-muted-foreground">
          No shared-pool usage in this range to simulate against.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {(
            [
              ["Free", free, limit],
              [`Pro (${proMultiplier}×)`, pro, limit * proMultiplier],
            ] as const
          ).map(([label, sim, effective]) => (
            <div key={label} className="rounded-lg border bg-muted/30 p-3">
              <div className="mb-2 flex items-baseline justify-between">
                <span className="text-sm font-medium">{label}</span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {fmt(effective)}/day
                </span>
              </div>
              <dl className="space-y-1.5 text-xs">
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-muted-foreground">Users affected</dt>
                  <dd className="tabular-nums">
                    <span className="font-medium">{sim.usersAffected}</span>
                    <span className="text-muted-foreground">
                      {" "}
                      of {sim.usersTotal} ({percentOf(sim.usersAffected, sim.usersTotal).toFixed(1)}%)
                    </span>
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-muted-foreground">User-days throttled</dt>
                  <dd className="tabular-nums">
                    <span className="font-medium">{sim.daysThrottled}</span>
                    <span className="text-muted-foreground">
                      {" "}
                      of {sim.daysTotal} ({percentOf(sim.daysThrottled, sim.daysTotal).toFixed(1)}%)
                    </span>
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-muted-foreground">Usage prevented</dt>
                  <dd className="tabular-nums">
                    <span className="font-medium">{fmt(sim.usagePrevented)}</span>
                    <span className="text-muted-foreground">
                      {" "}
                      of {fmt(sim.usageTotal)} (
                      {percentOf(sim.usagePrevented, sim.usageTotal).toFixed(1)}%)
                    </span>
                  </dd>
                </div>
              </dl>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Retrospective: applies the limit to usage already recorded, assuming demand
        would have been unchanged. Throttled users generally retry later, so
        &ldquo;usage prevented&rdquo; is an upper bound on savings rather than a forecast.
      </p>
    </div>
  )
}
