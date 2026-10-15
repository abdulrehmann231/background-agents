"use client"

import { TriangleAlert, Wallet, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { fmtCreditAmount } from "@/lib/format"
import type { CreditTier } from "@/lib/server/credits"

interface CreditWarningBannerProps {
  /** Which warning to show. The caller decides; see lib/credit-warning. */
  tier: Exclude<CreditTier, "ok">
  /** Balance in USD. Negative when the turn that emptied it overshot. */
  balanceUsd: number
  /** Opens the modal with purchases, rewards, and free usage options. */
  onAddCredits: () => void
  /** Records the dismissal and hides the banner. */
  onDismiss: () => void
  isMobile?: boolean
}

/**
 * The low/empty credit warning that sits above the composer.
 *
 * The low-credit banner offers credit options before a send is blocked.
 * Once the balance is depleted, the credit options modal opens automatically;
 * this banner remains available after the user dismisses that modal.
 *
 * Shape follows ErrorBanner (same border/tint idiom), with the icon and the
 * wording carrying the state as well as the colour, so it reads the same to
 * anyone who can't separate amber from red.
 */
export function CreditWarningBanner({
  tier,
  balanceUsd,
  onAddCredits,
  onDismiss,
  isMobile,
}: CreditWarningBannerProps) {
  const isEmpty = tier === "empty"

  return (
    <div
      data-testid="credit-warning-banner"
      role="status"
      className={cn(
        "flex items-start gap-2 rounded-md border px-3 py-2",
        isMobile ? "text-sm" : "text-[13px]",
        isEmpty
          ? "border-destructive/30 bg-destructive/10 text-destructive"
          : "border-yellow-500/30 bg-yellow-500/10 text-yellow-700 dark:text-yellow-400"
      )}
    >
      {isEmpty ? (
        <TriangleAlert className={cn("shrink-0 mt-0.5", isMobile ? "h-4 w-4" : "h-3.5 w-3.5")} />
      ) : (
        <Wallet className={cn("shrink-0 mt-0.5", isMobile ? "h-4 w-4" : "h-3.5 w-3.5")} />
      )}

      <div className="min-w-0 flex-1">
        {isEmpty ? (
          <>
            <span className="font-medium">Out of credits.</span>{" "}
            Add credits to keep using paid models, switch to a free model, or wait for tomorrow&apos;s daily credits.
          </>
        ) : (
          <>
            <span className="font-medium">
              Credits running low — {fmtCreditAmount(balanceUsd)} left.
            </span>{" "}
            Add credits to keep using paid models. You can buy credits or claim a GitHub star reward.
          </>
        )}{" "}
        <button
          type="button"
          onClick={onAddCredits}
          className="font-medium underline underline-offset-2 hover:no-underline cursor-pointer"
        >
          Add credits
        </button>
      </div>

      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss credit warning"
        title="Dismiss"
        className="shrink-0 rounded p-0.5 opacity-70 hover:opacity-100 hover:bg-foreground/10 transition-opacity cursor-pointer"
      >
        <X className={isMobile ? "h-4 w-4" : "h-3.5 w-3.5"} />
      </button>
    </div>
  )
}
