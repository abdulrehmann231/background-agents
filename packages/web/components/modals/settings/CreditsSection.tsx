"use client"

import { useCallback, useEffect, useState } from "react"
import { CreditCard, Plus } from "lucide-react"
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

  return (
    <div>
      {isMobile && <MobileSectionHeader icon={CreditCard} label="Credits" />}

      <p className="text-xs text-muted-foreground mb-3">
        Purchased credits, spent once your daily balance runs out. Unlike the
        daily balance, they never expire or reset on their own.
      </p>

      {creditsError ? (
        <div className="text-sm text-destructive py-3">{creditsError}</div>
      ) : !credits ? (
        <div className="space-y-3 py-3" aria-hidden>
          <div className="h-7 w-28 rounded bg-muted animate-pulse" />
          <div className="h-9 w-full rounded bg-muted animate-pulse" />
        </div>
      ) : (
        <>
          {/* Balance */}
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm font-medium">Available credits</span>
            <span
              className={cn(
                "text-lg font-semibold tabular-nums",
                credits.balanceUsd < 0 ? "text-destructive" : "text-foreground"
              )}
            >
              {credits.balanceUsd < 0
                ? `-${fmtBalance(Math.abs(credits.balanceUsd))}`
                : fmtBalance(credits.balanceUsd)}
            </span>
          </div>
          {credits.balanceUsd <= 0 && (
            <p className="text-[11px] text-muted-foreground mt-1">
              {credits.balanceUsd < 0
                ? "Your last turn ran past your balance. Top up to clear it and keep going."
                : "Top up to keep going once your daily balance runs out."}
            </p>
          )}

          {/* Top up */}
          <div className="mt-4 border-t border-border/30 pt-3">
            <div className="text-sm font-medium mb-2">Top up</div>
            {!packs ? (
              <div className="h-9 w-full rounded bg-muted animate-pulse" aria-hidden />
            ) : !packs.enabled || packs.packs.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Top-ups aren&apos;t available on this deployment yet.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {packs.packs.map((pack) => (
                  <button
                    key={pack.id}
                    onClick={() => buyPack(pack.id)}
                    disabled={buyingId !== null}
                    className={cn(
                      "flex items-center gap-1.5 rounded-lg border border-border hover:bg-accent/50 transition-colors px-3 py-2 text-sm font-medium cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    )}
                  >
                    <Plus className="h-3.5 w-3.5 text-muted-foreground" />
                    {pack.amountUsd != null
                      ? fmtBalance(pack.amountUsd)
                      : `${fmtBalance(pack.minUsd ?? 0)}–${fmtBalance(pack.maxUsd ?? 0)}`}
                    {buyingId === pack.id ? "…" : ""}
                  </button>
                ))}
              </div>
            )}
            {buyError && <p className="text-xs text-destructive mt-2">{buyError}</p>}
          </div>

          {/* Recent activity */}
          {credits.transactions.length > 0 && (
            <div className="mt-4 border-t border-border/30 pt-2">
              <div className="text-sm font-medium mb-1">Recent activity</div>
              {credits.transactions.map((t) => (
                <div
                  key={t.id}
                  className="flex items-baseline justify-between gap-2 py-1.5 text-xs"
                >
                  <span className="text-muted-foreground truncate pr-2">
                    {TRANSACTION_LABEL[t.type] ?? t.type}
                    {t.description ? ` — ${t.description}` : ""}
                  </span>
                  <span
                    className={cn(
                      "tabular-nums shrink-0",
                      t.amountUsd < 0 ? "text-muted-foreground" : "text-primary"
                    )}
                  >
                    {fmtSigned(t.amountUsd)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
