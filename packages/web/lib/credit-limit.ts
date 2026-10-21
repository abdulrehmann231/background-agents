import { sharedPoolProviderForModel, type Agent, type CredentialFlags } from "@/lib/types"
import { creditTier, normalizeMultiplier } from "@/lib/server/credits"

/** The paid shared pool that would block this selection, independent of banner dismissal. */
export function exhaustedCreditProvider({
  agent,
  model,
  credentialFlags,
  balanceUsd,
  providerMultipliers,
}: {
  agent: Agent
  model: string
  credentialFlags: CredentialFlags
  balanceUsd: number | null | undefined
  providerMultipliers?: Record<string, number>
}) {
  const provider = sharedPoolProviderForModel(agent, model, credentialFlags)
  if (!provider || normalizeMultiplier(providerMultipliers?.[provider]) === 0) return null
  return credentialFlags.SHARED_BALANCE_EXHAUSTED || creditTier(balanceUsd) === "empty"
    ? provider
    : null
}
