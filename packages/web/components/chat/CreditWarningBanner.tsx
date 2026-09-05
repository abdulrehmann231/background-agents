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
  /** Opens the Credits settings tab. */
  onBuyCredits: () => void
  /** Records the dismissal and hides the banner. */
  onDismiss: () => void
  isMobile?: boolean
}

/**
 * The low/empty credit warning that sits above the composer.
 *
 * A banner rather than a popover on purpose: a floating layer over the chat
 * would cover the messages the user is reading and fight the textarea for
 * focus, and this warning is never urgent enough to earn that. It is also not a
 * modal — `LimitReachedDialog` already interrupts the *blocked send*, and this
 * one's whole job is to arrive before that happens.
 *
 * Shape follows ErrorBanner (same border/tint idiom), with the icon and the
 * wording carrying the state as well as the colour, so it reads the same to
 * anyone who can't separate amber from red.
 */
export function CreditWarningBanner({
  tier,
  balanceUsd,
  onBuyCredits,
  onDismiss,
  isMobile,
}: CreditWarningBannerProps) {
  const isEmpty = tier === "empty"
  const overspent = balanceUsd < 0

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
            {overspent
              ? `Your last turn ran ${fmtCreditAmount(balanceUsd)} past your balance — top up to clear it, or wait for tomorrow's daily credits.`
              : "Top up to keep going, switch to a free model, or wait for tomorrow's daily credits."}
          </>
        ) : (
          <>
            <span className="font-medium">
              Credits running low — {fmtCreditAmount(balanceUsd)} left.
            </span>{" "}
            Your next turn on a shared model may not finish.
          </>
        )}{" "}
        <button
          type="button"
          onClick={onBuyCredits}
          className="font-medium underline underline-offset-2 hover:no-underline cursor-pointer"
        >
          Buy credits
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
