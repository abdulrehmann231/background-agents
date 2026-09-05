"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import * as Dialog from "@radix-ui/react-dialog"
import { Loader2, Wallet } from "lucide-react"
import { cn } from "@/lib/utils"
import { ModalHeader } from "@/components/ui/modal-header"
import { fmtBalance, fmtCreditAmount } from "@/lib/format"
import type { CreditPack } from "@/lib/server/stripe"

interface TopUpDialogProps {
  open: boolean
  onClose: () => void
  /** Packs as /api/billing/packs returned them: fixed amounts, then custom. */
  packs: CreditPack[]
  /** Current balance, shown so the user can see what they're topping up. */
  balanceUsd: number | null
  isMobile?: boolean
}

/** Amount the slider moves by — coarse for big ranges, $1 for small ones. */
function sliderStep(maxUsd: number): number {
  if (maxUsd > 500) return 25
  if (maxUsd > 100) return 5
  return 1
}

/**
 * Choose an amount, then go to Stripe.
 *
 * One amount drives everything — presets, slider and the field are three ways
 * of setting the same number, so there is never a selected chip disagreeing
 * with a typed value. Which price it buys is decided at submit: an amount that
 * lands exactly on a fixed pack buys that pack, anything else goes through the
 * custom-amount price (re-validated server-side against Stripe's bounds).
 */
export function TopUpDialog({ open, onClose, packs, balanceUsd, isMobile = false }: TopUpDialogProps) {
  const fixed = useMemo(
    () => packs.filter((p) => p.amountUsd != null).sort((a, b) => a.amountUsd! - b.amountUsd!),
    [packs]
  )
  const custom = useMemo(() => packs.find((p) => p.amountUsd == null) ?? null, [packs])

  const minUsd = custom?.minUsd ?? fixed[0]?.amountUsd ?? 5
  const maxUsd = custom?.maxUsd ?? fixed[fixed.length - 1]?.amountUsd ?? 100
  const defaultUsd = custom?.presetUsd ?? fixed[Math.floor(fixed.length / 2)]?.amountUsd ?? minUsd

  const [amount, setAmount] = useState(defaultUsd)
  const [text, setText] = useState(defaultUsd.toFixed(0))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const buyRef = useRef<HTMLButtonElement>(null)

  // Reopening starts from the default again rather than from whatever was left
  // over from a cancelled checkout.
  useEffect(() => {
    if (open) {
      setAmount(defaultUsd)
      setText(defaultUsd.toFixed(0))
      setError(null)
      setSubmitting(false)
    }
  }, [open, defaultUsd])

  const setBoth = useCallback((usd: number) => {
    setAmount(usd)
    setText(Number.isInteger(usd) ? usd.toFixed(0) : usd.toFixed(2))
    setError(null)
  }, [])

  const onText = useCallback((raw: string) => {
    // Digits and one decimal point only, so the field can't hold something the
    // slider and the button below would have to disagree about.
    const cleaned = raw.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1")
    setText(cleaned)
    const parsed = Number.parseFloat(cleaned)
    setAmount(Number.isFinite(parsed) ? parsed : NaN)
    setError(null)
  }, [])

  const matchedFixed = fixed.find((p) => Math.abs(p.amountUsd! - amount) < 0.005) ?? null
  const canBuy = custom
    ? Number.isFinite(amount) && amount >= minUsd && amount <= maxUsd
    : matchedFixed !== null
  const outOfRange = custom != null && text !== "" && !canBuy

  const buy = useCallback(async () => {
    const pack = matchedFixed ?? custom
    if (!pack || !canBuy) return
    setError(null)
    setSubmitting(true)
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          matchedFixed
            ? { packId: matchedFixed.id }
            : { packId: pack.id, amountUsd: Math.round(amount * 100) / 100 }
        ),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || typeof data.url !== "string") {
        throw new Error(data.error || "Could not start checkout")
      }
      // Full navigation, not a fetch redirect: Checkout is a hosted Stripe
      // page, and the success/cancel URLs bring the user straight back here.
      window.location.href = data.url
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start checkout")
      setSubmitting(false)
    }
  }, [matchedFixed, custom, canBuy, amount])

  return (
    <Dialog.Root open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <Dialog.Portal>
        {/* Above the settings modal this opens from (z-50). */}
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/25 backdrop-blur-[1px]" />
        <Dialog.Content
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            buyRef.current?.focus()
          }}
          className={cn(
            "fixed z-[60] bg-popover overflow-hidden flex flex-col",
            isMobile
              ? "inset-x-4 top-1/2 -translate-y-1/2 rounded-xl border border-border"
              : "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-sm border border-border rounded-xl shadow-xl"
          )}
        >
          <ModalHeader
            title={
              <>
                <Wallet className="h-4 w-4 text-muted-foreground" />
                Buy credits
              </>
            }
          />

          <div className="px-4 pt-4 pb-4 space-y-4">
            {/* What you'll pay — the one number that matters, restated large so
                the presets, slider and field all visibly land somewhere. */}
            <div className="text-center">
              <div className="text-4xl font-semibold tabular-nums text-foreground">
                {fmtBalance(Number.isFinite(amount) ? Math.max(amount, 0) : 0)}
              </div>
              {balanceUsd != null && canBuy && (
                <div className="mt-1 text-xs text-muted-foreground tabular-nums">
                  New balance {fmtCreditAmount(balanceUsd + amount)}
                </div>
              )}
            </div>

            {/* Presets */}
            {fixed.length > 0 && (
              <div className="grid grid-cols-4 gap-1.5">
                {fixed.map((pack) => {
                  const selected = matchedFixed?.id === pack.id
                  return (
                    <button
                      key={pack.id}
                      type="button"
                      onClick={() => setBoth(pack.amountUsd!)}
                      disabled={submitting}
                      className={cn(
                        "rounded-lg border py-2 text-sm font-medium tabular-nums transition-colors cursor-pointer",
                        "focus:outline-none focus:ring-2 focus:ring-ring/50 disabled:opacity-50 disabled:cursor-not-allowed",
                        selected
                          ? "border-primary bg-primary/10 text-foreground"
                          : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
                      )}
                    >
                      {fmtBalance(pack.amountUsd!)}
                    </button>
                  )
                })}
              </div>
            )}

            {/* Slider + field, both only meaningful when a custom-amount price
                exists to bill an arbitrary number against. */}
            {custom && (
              <div className="space-y-3">
                <div>
                  <input
                    type="range"
                    min={minUsd}
                    max={maxUsd}
                    step={sliderStep(maxUsd)}
                    value={Math.min(Math.max(Number.isFinite(amount) ? amount : minUsd, minUsd), maxUsd)}
                    onChange={(e) => setBoth(Number(e.target.value))}
                    disabled={submitting}
                    aria-label="Top-up amount"
                    className={cn(
                      "w-full h-1.5 appearance-none rounded-full bg-muted cursor-pointer accent-primary",
                      "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                      "[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4",
                      "[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary",
                      "[&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-background",
                      "[&::-webkit-slider-thumb]:shadow [&::-webkit-slider-thumb]:cursor-grab",
                      "[&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full",
                      "[&::-moz-range-thumb]:bg-primary [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-background",
                      "disabled:opacity-50 disabled:cursor-not-allowed"
                    )}
                  />
                  <div className="mt-1 flex justify-between text-[11px] text-muted-foreground tabular-nums">
                    <span>{fmtBalance(minUsd)}</span>
                    <span>{fmtBalance(maxUsd)}</span>
                  </div>
                </div>

                <div>
                  <label htmlFor="topup-amount" className="block text-xs text-muted-foreground mb-1">
                    Or enter an amount
                  </label>
                  <div
                    className={cn(
                      "flex items-center rounded-md border bg-background transition-colors",
                      "focus-within:ring-2 focus-within:ring-ring/40",
                      outOfRange ? "border-destructive/60" : "border-border focus-within:border-primary/60"
                    )}
                  >
                    <span className="pl-2.5 pr-1 text-sm text-muted-foreground">$</span>
                    <input
                      id="topup-amount"
                      inputMode="decimal"
                      value={text}
                      onChange={(e) => onText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && canBuy && !submitting) buy()
                      }}
                      disabled={submitting}
                      className="h-8 w-full bg-transparent pr-2.5 text-sm tabular-nums outline-none disabled:opacity-50"
                    />
                  </div>
                  {outOfRange && (
                    <p className="mt-1 text-[11px] text-destructive">
                      Enter an amount between {fmtBalance(minUsd)} and {fmtBalance(maxUsd)}.
                    </p>
                  )}
                </div>
              </div>
            )}

            {error && <p className="text-xs text-destructive">{error}</p>}

            <button
              ref={buyRef}
              type="button"
              onClick={buy}
              disabled={!canBuy || submitting}
              className={cn(
                "flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2.5 text-sm font-medium text-primary-foreground",
                "transition-colors hover:bg-primary/90 cursor-pointer",
                "focus:outline-none focus:ring-2 focus:ring-ring/60",
                "disabled:opacity-50 disabled:cursor-not-allowed"
              )}
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {submitting
                ? "Opening checkout…"
                : canBuy
                  ? `Buy ${fmtBalance(amount)} in credits`
                  : "Choose an amount"}
            </button>

            <p className="text-center text-[11px] text-muted-foreground">
              You&apos;ll be taken to Stripe to pay. Credits never expire.
            </p>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
