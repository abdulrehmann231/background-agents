"use client"

import { useCallback, useState } from "react"
import { useSession } from "next-auth/react"
import { useSettingsQuery } from "@/lib/query/hooks/useSettingsQuery"
import { readJSON, writeJSON } from "@/lib/storage"
import {
  dismissalStorageKey,
  parseDismissal,
  warningTierToShow,
  type CreditWarningDismissal,
} from "@/lib/credit-warning"
import { sharedPoolProviderForModel, type Agent, type CredentialFlags } from "@/lib/types"
import type { CreditTier } from "@/lib/server/credits"

export interface CreditWarning {
  /** The banner to render, or null for none. */
  tier: Exclude<CreditTier, "ok"> | null
  /** Balance in USD — only meaningful when `tier` is non-null. */
  balanceUsd: number
  /** Record the dismissal (per user, this device) and hide the banner. */
  dismiss: () => void
}

/**
 * Whether the composer should be warning about credits right now.
 *
 * Balance comes from the settings query, which already carries it (see
 * getEffectiveCredentialFlags) and is invalidated when a turn completes, so the
 * banner reflects the spend of the turn the user just watched run.
 *
 * The `sharedPoolProviderForModel` check is what ties the warning to the
 * *current selection* rather than to the account: it is the client mirror of
 * the server's `resolvePool`, so the banner appears exactly when the next send
 * would draw the balance down — never on a BYOK key, a custom endpoint, or a
 * free model, where the balance gates nothing.
 *
 * The dismissal record is read into state once per mount rather than on every
 * render: it only changes when this hook writes it, and re-reading localStorage
 * during render would make the component's output depend on something React
 * cannot see change.
 */
export function useCreditWarning({
  agent,
  model,
  credentialFlags,
}: {
  agent: Agent
  model: string
  credentialFlags: CredentialFlags
}): CreditWarning {
  const { data: session } = useSession()
  const userId = session?.user?.id ?? null
  const { data: settingsData } = useSettingsQuery()
  const balanceUsd = settingsData?.creditBalanceUsd ?? null

  const [dismissal, setDismissal] = useState<CreditWarningDismissal | null>(() => null)
  const [loadedFor, setLoadedFor] = useState<string | null>(null)

  // Load (and reload on a user switch) the stored dismissal. Done in render
  // rather than an effect so the first paint after a login already respects it
  // — an effect would flash the banner for one frame at a user who dismissed it.
  if (userId && loadedFor !== userId) {
    setLoadedFor(userId)
    setDismissal(parseDismissal(readJSON(dismissalStorageKey(userId), null, "credit warning")))
  }

  const drawsSharedPool =
    sharedPoolProviderForModel(agent, model, credentialFlags) !== null

  const tier = warningTierToShow({
    balanceUsd,
    drawsSharedPool,
    dismissal,
    now: Date.now(),
  })

  const dismiss = useCallback(() => {
    if (!tier || typeof balanceUsd !== "number") return
    const record: CreditWarningDismissal = {
      tier,
      dismissedAt: Date.now(),
      balanceAtDismiss: balanceUsd,
    }
    setDismissal(record)
    if (userId) writeJSON(dismissalStorageKey(userId), record, "credit warning")
  }, [tier, balanceUsd, userId])

  return { tier, balanceUsd: balanceUsd ?? 0, dismiss }
}
