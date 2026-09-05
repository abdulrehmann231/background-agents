"use client"

import { useCallback, useEffect, useState } from "react"
import { formatDistanceToNow } from "date-fns"
import { CreditCard, Plus, TriangleAlert } from "lucide-react"
import { cn } from "@/lib/utils"
import { MobileSectionHeader } from "./shared"
import { TopUpDialog } from "./TopUpDialog"
import { fmtCreditAmount } from "@/lib/format"
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
  daily: "Daily credit",
  chargeback: "Chargeback",
  adjustment: "Adjustment",
}

/**
 * Sign a ledger amount. Four decimals, like the balance above it — a charge is
 * discounted before it reaches the balance, so at two the rows would not visibly
 * add up to the number they moved.
 */
function fmtSigned(usd: number): string {
  return `${usd < 0 ? "-" : "+"}${fmtCreditAmount(usd)}`
}

/**
 * Purchased credits: balance, top-up, and recent activity.
 *
 * This is the only balance that actually gates a send now (see
 * lib/db/usage-limit) — the daily numbers under the Usage tab are informational
 * only, which is why this tab, not that one, is what's surfaced by default.
 *
 * Buying is one button, not a wall of packs: the amount is chosen in
 * TopUpDialog, so this tab stays about the balance and where it went.
 */
export function CreditsSection({ isMobile }: CreditsSectionProps) {
  const [credits, setCredits] = useState<UserCreditsResponse | null>(null)
  const [creditsError, setCreditsError] = useState<string | null>(null)
  const [packs, setPacks] = useState<PacksResponse | null>(null)
  const [topUpOpen, setTopUpOpen] = useState(false)

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

    // Packs failing (billing not configured on this deployment) just disables
    // the buy button rather than blocking the balance/history around it.
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

  const closeTopUp = useCallback(() => setTopUpOpen(false), [])

  const isNegative = !!credits && credits.balanceUsd < 0
  const isEmpty = !!credits && credits.balanceUsd === 0
  const canBuy = !!packs?.enabled && packs.packs.length > 0

  return (
    <div>
      {isMobile && <MobileSectionHeader icon={CreditCard} label="Credits" />}

      {creditsError ? (
        <div className="text-sm text-destructive py-3">{creditsError}</div>
      ) : !credits ? (
        <div className="space-y-3" aria-hidden>
          <div className="h-24 w-full rounded-xl bg-muted animate-pulse" />
          <div className="h-4 w-32 rounded bg-muted animate-pulse" />
          <div className="h-24 w-full rounded-lg bg-muted animate-pulse" />
        </div>
      ) : (
        <>
          {/* Balance — one hero number and one action. Status is called out with
              an icon and words, never colour alone. */}
          <div
            className={cn(
              "rounded-xl border p-4",
              isNegative ? "border-destructive/30 bg-destructive/5" : "border-border bg-muted/30"
            )}
          >
            <div className="text-xs font-medium text-muted-foreground">Available credits</div>

            <div className="mt-1.5 flex flex-wrap items-end justify-between gap-3">
              <div>
                <div
                  className={cn(
                    "text-4xl font-semibold tabular-nums leading-none",
                    isNegative ? "text-destructive" : "text-foreground"
                  )}
                >
                  {isNegative ? "-" : ""}
                  {fmtCreditAmount(credits.balanceUsd)}
                </div>
                <div className="mt-1.5 text-[11px] text-muted-foreground">
                  Never expires · shared across Claude, OpenCode and Gemini
                </div>
              </div>

              <button
                type="button"
                onClick={() => setTopUpOpen(true)}
                disabled={!canBuy}
                title={canBuy ? undefined : "Top-ups aren't available on this deployment yet"}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground",
                  "transition-colors hover:bg-primary/90 cursor-pointer",
                  "focus:outline-none focus:ring-2 focus:ring-ring/60",
                  "disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-primary"
                )}
              >
                <Plus className="h-4 w-4" />
                Buy credits
              </button>
            </div>

            {(isNegative || isEmpty) && (
              <div
                className={cn(
                  "mt-3 flex items-start gap-1.5 border-t pt-3 text-xs",
                  isNegative
                    ? "border-destructive/20 text-destructive"
                    : "border-border/50 text-muted-foreground"
                )}
              >
                {isNegative && <TriangleAlert className="h-3.5 w-3.5 shrink-0 mt-px" />}
                <span>
                  {isNegative
                    ? "Your last turn ran past your balance — top up to clear it, or wait for your daily credits to catch up."
                    : "Top up to keep going, switch to a free model, or wait for tomorrow's daily credit."}
                </span>
              </div>
            )}
          </div>

          {!canBuy && packs && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Top-ups aren&apos;t available on this deployment yet.
            </p>
          )}

          {/* Recent activity — a plain ledger. Amounts are the only thing worth
              scanning, so they're the only thing aligned and emphasised. */}
          {credits.transactions.length > 0 && (
            <div className="mt-6">
              <div className="text-xs font-medium text-muted-foreground mb-1">
                Recent activity
              </div>
              <div className="divide-y divide-border/40">
                {credits.transactions.map((t) => {
                  const isCredit = t.amountUsd >= 0
                  return (
                    <div key={t.id} className="flex items-baseline gap-3 py-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs text-foreground">
                          {TRANSACTION_LABEL[t.type] ?? t.type}
                          {t.description && (
                            <span className="text-muted-foreground"> · {t.description}</span>
                          )}
                        </div>
                      </div>
                      <div className="shrink-0 text-[11px] text-muted-foreground">
                        {formatDistanceToNow(new Date(t.createdAt), { addSuffix: true })}
                      </div>
                      <div
                        className={cn(
                          "w-24 shrink-0 text-right text-xs font-medium tabular-nums",
                          isCredit ? "text-foreground" : "text-muted-foreground"
                        )}
                      >
                        {fmtSigned(t.amountUsd)}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </>
      )}

      {canBuy && (
        <TopUpDialog
          open={topUpOpen}
          onClose={closeTopUp}
          packs={packs!.packs}
          balanceUsd={credits?.balanceUsd ?? null}
          isMobile={isMobile}
        />
      )}
    </div>
  )
}
