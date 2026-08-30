"use client"

import { useState } from "react"
import { ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatMetricValue } from "./charts/chartFormatters"
import type { UsageMetric, UserUsage } from "@/lib/query/hooks"

interface UsageByUserTableProps {
  users: UserUsage[]
  metric: UsageMetric
  /**
   * Whether a dollar figure says anything useful for this provider. True for
   * OpenCode (billed per token) and Claude (shared pool budgeted in dollars, so
   * per-model cost is what explains a user hitting their cap). False for Gemini,
   * capped by message count — the Cost column is dropped from the per-model
   * detail rather than shown as a number nobody can act on. Whether those
   * dollars are an actual invoice line is a separate question, labelled at the
   * section header.
   */
  showCost?: boolean
  isLoading?: boolean
}

/** Share of a user's usage that ran on our credentials, 0–100. */
function sharedShare(user: UserUsage, metric: UsageMetric): number {
  const total = metric === "cost" ? user.cost : user.tokens
  if (total <= 0) return 0
  const shared = metric === "cost" ? user.sharedCost : user.sharedTokens
  return (shared / total) * 100
}

/**
 * Per-user usage, expandable to a per-model breakdown.
 *
 * A table rather than a chart on purpose: "who used what, on which model, from
 * which pool" is four dimensions, and a table reads them at a glance where a
 * chart would need encoding tricks. Rows are collapsed by default so the
 * default view stays a simple ranked list.
 */
export function UsageByUserTable({
  users,
  metric,
  showCost = true,
  isLoading,
}: UsageByUserTableProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const toggle = (userId: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(userId)) next.delete(userId)
      else next.add(userId)
      return next
    })

  const value = (u: UserUsage) => (metric === "cost" ? u.cost : u.tokens)

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="h-7 w-7 rounded-full bg-muted animate-pulse" />
            <div className="h-4 flex-1 rounded bg-muted animate-pulse" />
            <div className="h-4 w-16 rounded bg-muted animate-pulse" />
          </div>
        ))}
      </div>
    )
  }

  if (users.length === 0) {
    return (
      <div className="flex h-[180px] items-center justify-center text-center text-muted-foreground text-sm">
        No usage recorded for this provider in this range
      </div>
    )
  }

  const maxValue = Math.max(...users.map(value), 1)

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50 text-xs">
            <th className="px-2 py-2 text-left font-medium sm:px-3">User</th>
            <th className="px-2 py-2 text-right font-medium sm:px-3">
              {metric === "cost" ? "Cost" : "Tokens"}
            </th>
            <th className="hidden px-2 py-2 text-right font-medium sm:table-cell sm:px-3">
              On our pool
            </th>
            <th className="hidden px-2 py-2 text-right font-medium md:table-cell md:px-3">
              Models
            </th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => {
            const isOpen = expanded.has(user.userId)
            const v = value(user)
            const share = sharedShare(user, metric)
            return [
              <tr
                key={user.userId}
                onClick={() => toggle(user.userId)}
                className="cursor-pointer border-b hover:bg-muted/50"
              >
                <td className="px-2 py-2 sm:px-3">
                  <div className="flex items-center gap-2">
                    <ChevronRight
                      className={cn(
                        "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
                        isOpen && "rotate-90"
                      )}
                    />
                    {user.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={user.image} alt="" className="h-6 w-6 shrink-0 rounded-full" />
                    ) : (
                      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                        {user.name[0]?.toUpperCase() || "?"}
                      </div>
                    )}
                    <span className="truncate font-medium">{user.name}</span>
                  </div>
                </td>
                <td className="px-2 py-2 text-right sm:px-3">
                  <div className="flex items-center justify-end gap-2">
                    {/* Inline bar: relative size is easier to scan than numbers alone. */}
                    <span className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-muted sm:block">
                      <span
                        className="block h-full rounded-full bg-primary"
                        style={{ width: `${Math.max(2, (v / maxValue) * 100)}%` }}
                      />
                    </span>
                    <span className="tabular-nums">{formatMetricValue(metric, v)}</span>
                  </div>
                </td>
                <td className="hidden px-2 py-2 text-right tabular-nums sm:table-cell sm:px-3">
                  <span className={cn(share > 0 ? "text-foreground" : "text-muted-foreground")}>
                    {share.toFixed(0)}%
                  </span>
                </td>
                <td className="hidden px-2 py-2 text-right tabular-nums text-muted-foreground md:table-cell md:px-3">
                  {user.models.length}
                </td>
              </tr>,

              isOpen && (
                <tr key={`${user.userId}-detail`} className="border-b bg-muted/20">
                  <td colSpan={4} className="px-2 py-2 sm:px-3">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-muted-foreground">
                          <th className="py-1 text-left font-medium">Model</th>
                          <th className="py-1 text-left font-medium">Pool</th>
                          <th className="py-1 text-right font-medium">Tokens</th>
                          {showCost && <th className="py-1 text-right font-medium">Cost</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {user.models.map((m, i) => (
                          <tr key={`${m.model}-${m.pool}-${i}`}>
                            <td className="py-1 pr-2 font-mono">{m.model}</td>
                            <td className="py-1 pr-2">
                              <span
                                className={cn(
                                  "rounded px-1.5 py-0.5 text-[10px] font-medium",
                                  m.pool === "shared"
                                    ? "bg-primary/10 text-primary"
                                    : "bg-muted text-muted-foreground"
                                )}
                              >
                                {m.pool === "shared" ? "our pool" : "own key"}
                              </span>
                            </td>
                            <td className="py-1 text-right tabular-nums">
                              {formatMetricValue("tokens", m.tokens)}
                            </td>
                            {showCost && (
                              <td className="py-1 text-right tabular-nums">
                                {formatMetricValue("cost", m.cost)}
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </td>
                </tr>
              ),
            ]
          })}
        </tbody>
      </table>
      <p className="mt-3 text-xs text-muted-foreground">
        Click a row for the per-model breakdown. &ldquo;On our pool&rdquo; is the share
        of that user&apos;s usage running on our credentials rather than their own key.
      </p>
    </div>
  )
}
