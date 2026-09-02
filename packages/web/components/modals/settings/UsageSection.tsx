"use client"

import { useEffect, useState } from "react"
import { Gauge } from "lucide-react"
import { cn } from "@/lib/utils"
import { MobileSectionHeader } from "./shared"
import type { UsageResponse } from "@/app/api/user/usage/route"
import { fmtBalance } from "@/lib/format"
import { PRO_BUDGET_MULTIPLIER } from "@/lib/server/usage-budgets"

/** Tailwind classes for the bar fill based on how close to the limit we are. */
function fillClass(pct: number): string {
  if (pct >= 1) return "bg-red-500"
  if (pct >= 0.8) return "bg-amber-500"
  return "bg-primary"
}

interface UsageSectionProps {
  isMobile: boolean
}

/**
 * Today's spend against the daily balance.
 *
 * One balance covers every shared pool, so this is a single bar with a per-pool
 * breakdown underneath — the breakdown is where the money went, not separate
 * budgets. Own-key pools are listed as such: they draw nothing.
 */
export function UsageSection({ isMobile }: UsageSectionProps) {
  const [data, setData] = useState<UsageResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setError(null)
    fetch("/api/user/usage")
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load usage (${res.status})`)
        return (await res.json()) as UsageResponse
      })
      .then((d) => {
        if (!cancelled) setData(d)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load usage")
      })
    return () => {
      cancelled = true
    }
  }, [])

  const unlimited = data?.limit == null
  const pct =
    data && data.limit != null ? Math.min(1, data.used / Math.max(data.limit, 0.0001)) : 0

  return (
    <div>
      {isMobile && <MobileSectionHeader icon={Gauge} label="Usage" />}

      <p className="text-xs text-muted-foreground mb-3">
        Your daily balance, spent across every shared pool. Resets at 00:00 UTC.
        Free models don&apos;t draw from it.
      </p>

      {error ? (
        <div className="text-sm text-destructive py-3">{error}</div>
      ) : !data ? (
        <div className="space-y-3 py-3" aria-hidden>
          <div className="h-3 w-32 rounded bg-muted animate-pulse" />
          <div className="h-2 w-full rounded-full bg-muted animate-pulse" />
          <div className="h-3 w-full rounded bg-muted animate-pulse" />
        </div>
      ) : (
        <div>
          {/* The allowance */}
          <div className="flex items-baseline justify-between gap-2 mb-1.5">
            <span className="text-sm font-medium">Used today</span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {unlimited ? (
                <>
                  {fmtBalance(data.used)} <span className="text-primary">· Unlimited</span>
                </>
              ) : (
                <>
                  {fmtBalance(data.used)} / {fmtBalance(data.limit!)}
                </>
              )}
            </span>
          </div>

          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                unlimited ? "bg-primary/40" : fillClass(pct)
              )}
              style={{ width: unlimited ? "100%" : `${Math.max(2, pct * 100)}%` }}
            />
          </div>

          {!unlimited && (
            <div className="mt-1 text-[11px] text-muted-foreground tabular-nums">
              {fmtBalance(Math.max(0, data.limit! - data.used))} left
            </div>
          )}

          {/* Where they went */}
          <div className="mt-4 border-t border-border/30 pt-2">
            {data.pools.map((pool) => (
              <div
                key={pool.provider}
                className="flex items-baseline justify-between gap-2 py-1.5 text-xs"
              >
                <span className="text-muted-foreground">{pool.label}</span>
                <span className="tabular-nums text-muted-foreground">
                  {pool.ownKey ? (
                    "Your own key"
                  ) : pool.used > 0 ? (
                    <span className="text-foreground">{fmtBalance(pool.used)}</span>
                  ) : (
                    "—"
                  )}
                </span>
              </div>
            ))}
          </div>

          {data.plan === "unlimited" ? (
            <p className="text-[11px] text-primary mt-2">
              Unlimited plan — shared pools are uncapped. Usage shown for reference.
            </p>
          ) : data.plan === "pro" ? (
            <p className="text-[11px] text-primary mt-2">
              Pro plan — {PRO_BUDGET_MULTIPLIER}× the free daily balance.
            </p>
          ) : null}
        </div>
      )}
    </div>
  )
}
