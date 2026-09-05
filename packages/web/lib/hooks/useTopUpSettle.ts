"use client"

import { useEffect } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query"
import type { SettingsData } from "@/lib/query/hooks/useSettingsQuery"

/**
 * How long to keep re-checking, and how often.
 *
 * Sized against the gap this exists to cover — Stripe's redirect racing its own
 * webhook — not against any guarantee. Six checks at 2.5s covers ~15s, which is
 * comfortably past the "few seconds" the success toast promises. If the webhook
 * is slower than that, the balance still lands on the next focus refetch or the
 * next completed turn; this only makes the common case immediate.
 */
const SETTLE_ATTEMPTS = 6
const SETTLE_INTERVAL_MS = 2500

/**
 * Re-check the credit balance for a few seconds after returning from Stripe.
 *
 * The balance is credited by the Stripe webhook, out of band from the redirect
 * that brings the user back here — so the settings query this page mounts with
 * almost always predates the payment. Without this the composer keeps a red dot
 * (and keeps refusing agent switches through `agentSharedPoolExhausted`) over a
 * balance the user has already paid for, until they happen to tab away and back.
 *
 * Stops early the moment the balance rises, so the common case is one or two
 * extra requests rather than six.
 */
export function useTopUpSettle(active: boolean): void {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!active) return

    const readBalance = () =>
      queryClient.getQueryData<SettingsData>(queryKeys.settings.all)?.creditBalanceUsd ?? null

    const before = readBalance()
    let attempts = 0
    let cancelled = false

    const timer = setInterval(async () => {
      attempts += 1
      await queryClient.invalidateQueries({ queryKey: queryKeys.settings.all })
      if (cancelled) return

      const after = readBalance()
      const credited =
        typeof before === "number" && typeof after === "number" && after > before
      if (credited || attempts >= SETTLE_ATTEMPTS) {
        clearInterval(timer)
      }
    }, SETTLE_INTERVAL_MS)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [active, queryClient])
}
