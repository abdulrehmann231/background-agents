"use client"

import { useCallback, useEffect, useState } from "react"
import { formatDistanceToNow } from "date-fns"
import {
  ArrowDownRight,
  ArrowUpRight,
  Coins,
  CreditCard,
  Loader2,
  TriangleAlert,
  Wallet,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { MobileSectionHeader } from "./shared"
import { fmtBalance } from "@/lib/format"
import type { UserCreditsResponse } from "@/app/api/user/credits/route"
import type { PacksResponse } from "@/app/api/billing/packs/route"

interface CreditsSectionProps {
  isMobile: boolean
}

const TRANSACTION_LABEL: Record<string, string> = {
  purchase: "Top-up",
  debit: "Usage",
  refund: "Refund",
  grant: "Credit grant",
  chargeback: "Chargeback",
  adjustment: "Adjustment",
}

/** `fmtBalance` doesn't sign negatives (toFixed(2) on -12.5 reads "$-12.50"). */
function fmtSigned(usd: number): string {
  return usd < 0 ? `-${fmtBalance(Math.abs(usd))}` : `+${fmtBalance(usd)}`
}

/**
 * Purchased credits: balance, top-up, and recent activity.
 *
 * This is the only balance that actually gates a send now (see
 * lib/db/usage-limit) — the daily numbers under the Usage tab are informational
 * only, which is why this tab, not that one, is what's surfaced by default.
 */
export function CreditsSection({ isMobile }: CreditsSectionProps) {
  const [credits, setCredits] = useState<UserCreditsResponse | null>(null)
  const [creditsError, setCreditsError] = useState<string | null>(null)
  const [packs, setPacks] = useState<PacksResponse | null>(null)
  const [buyingId, setBuyingId] = useState<string | null>(null)
  const [buyError, setBuyError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    fetch("/api/user/credits")
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load credits (${res.status})`)
        return (await res.json()) as UserCreditsResponse
      })
      .then((d) => {
        if (!cancelled) setCredits(d)
      })
      .catch((e) => {
        if (!cancelled) setCreditsError(e instanceof Error ? e.message : "Failed to load credits")
      })

    // Packs failing (billing not configured on this deployment) just hides
    // the top-up row rather than blocking the balance/history above it.
    fetch("/api/billing/packs")
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load packs (${res.status})`)
        return (await res.json()) as PacksResponse
      })
      .then((d) => {
        if (!cancelled) setPacks(d)
      })
      .catch(() => {
        if (!cancelled) setPacks({ enabled: false, packs: [] })
      })

    return () => {
      cancelled = true
    }
  }, [])

  const buyPack = useCallback(async (packId: string) => {
    setBuyError(null)
    setBuyingId(packId)
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || typeof data.url !== "string") {
        throw new Error(data.error || "Could not start checkout")
      }
      // Full navigation, not a fetch redirect: Checkout is a hosted Stripe
      // page, and the success/cancel URLs bring the user straight back here.
      window.location.href = data.url
    } catch (e) {
      setBuyError(e instanceof Error ? e.message : "Could not start checkout")
      setBuyingId(null)
    }
  }, [])

  const isNegative = !!credits && credits.balanceUsd < 0
  const isEmpty = !!credits && credits.balanceUsd === 0

  return (
    <div>
      {isMobile && <MobileSectionHeader icon={CreditCard} label="Credits" />}

      <p className="text-xs text-muted-foreground mb-4">
        Purchased credits, spent once your daily balance runs out. Unlike the
        daily balance, they never expire or reset on their own.
      </p>

      {creditsError ? (
        <div className="text-sm text-destructive py-3">{creditsError}</div>
      ) : !credits ? (
        <div className="space-y-4" aria-hidden>
          <div className="h-[72px] w-full rounded-xl bg-muted animate-pulse" />
          <div className="grid grid-cols-3 gap-2">
            <div className="h-16 rounded-lg bg-muted animate-pulse" />
            <div className="h-16 rounded-lg bg-muted animate-pulse" />
            <div className="h-16 rounded-lg bg-muted animate-pulse" />
          </div>
        </div>
      ) : (
        <>
          {/* Balance — the stat tile: one hero number, status called out with an
              icon + label rather than color alone. */}
          <div
            className={cn(
              "rounded-xl border p-4",
              isNegative ? "border-destructive/30 bg-destructive/5" : "border-border bg-muted/30"
            )}
          >
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Wallet className="h-3.5 w-3.5" />
              Available credits
            </div>
            <div
              className={cn(
                "mt-1 text-3xl font-semibold",
                isNegative ? "text-destructive" : "text-foreground"
              )}
            >
              {isNegative ? `-${fmtBalance(Math.abs(credits.balanceUsd))}` : fmtBalance(credits.balanceUsd)}
            </div>
            {(isNegative || isEmpty) && (
              <div
                className={cn(
                  "mt-2 flex items-center gap-1.5 text-xs",
                  isNegative ? "text-destructive" : "text-muted-foreground"
                )}
              >
                {isNegative && <TriangleAlert className="h-3.5 w-3.5 shrink-0" />}
                <span>
                  {isNegative
                    ? "Your last turn ran past your balance — top up to clear it and keep going."
                    : "Top up to keep going once your daily balance runs out."}
                </span>
              </div>
            )}
          </div>

          {/* Top up */}
          <div className="mt-5">
            <div className="text-sm font-medium mb-2">Top up</div>
            {!packs ? (
              <div className="grid grid-cols-3 gap-2" aria-hidden>
                <div className="h-16 rounded-lg bg-muted animate-pulse" />
                <div className="h-16 rounded-lg bg-muted animate-pulse" />
                <div className="h-16 rounded-lg bg-muted animate-pulse" />
              </div>
            ) : !packs.enabled || packs.packs.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
                Top-ups aren&apos;t available on this deployment yet.
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {packs.packs.map((pack) => {
                  const isCustom = pack.amountUsd == null
                  const isBuying = buyingId === pack.id
                  return (
                    <button
                      key={pack.id}
                      onClick={() => buyPack(pack.id)}
                      disabled={buyingId !== null}
                      className={cn(
                        "group relative flex flex-col items-start gap-1 rounded-lg border border-border bg-background p-3 text-left transition-colors cursor-pointer",
                        "hover:border-primary/40 hover:bg-primary/5",
                        "disabled:cursor-not-allowed disabled:hover:border-border disabled:hover:bg-background",
                        !isBuying && buyingId !== null && "opacity-50"
                      )}
                    >
                      <Coins className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                      <span className="text-lg font-semibold text-foreground">
                        {isCustom ? "Custom" : fmtBalance(pack.amountUsd!)}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {isCustom
                          ? `${fmtBalance(pack.minUsd ?? 0)}–${fmtBalance(pack.maxUsd ?? 0)}`
                          : "One-time top-up"}
                      </span>
                      {isBuying && (
                        <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-background/80">
                          <Loader2 className="h-4 w-4 animate-spin text-primary" />
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
            {buyError && <p className="text-xs text-destructive mt-2">{buyError}</p>}
          </div>

          {/* Recent activity */}
          {credits.transactions.length > 0 && (
            <div className="mt-5 border-t border-border/30 pt-3">
              <div className="text-sm font-medium mb-1">Recent activity</div>
              {credits.transactions.map((t) => {
                const isCredit = t.amountUsd >= 0
                return (
                  <div key={t.id} className="flex items-center gap-3 py-2">
                    <div
                      className={cn(
                        "flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
                        isCredit ? "bg-green-500/10" : "bg-muted"
                      )}
                    >
                      {isCredit ? (
                        <ArrowUpRight className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
                      ) : (
                        <ArrowDownRight className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium text-foreground">
                        {TRANSACTION_LABEL[t.type] ?? t.type}
                      </div>
                      <div className="truncate text-[11px] text-muted-foreground">
                        {t.description ? `${t.description} · ` : ""}
                        {formatDistanceToNow(new Date(t.createdAt), { addSuffix: true })}
                      </div>
                    </div>
                    <div
                      className={cn(
                        "shrink-0 text-xs font-medium tabular-nums",
                        isCredit ? "text-green-600 dark:text-green-400" : "text-muted-foreground"
                      )}
                    >
                      {fmtSigned(t.amountUsd)}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
