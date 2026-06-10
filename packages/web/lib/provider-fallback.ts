/**
 * Provider fallback resolution.
 *
 * When an upstream provider reports its own limit is exhausted (Claude's
 * 5-hour / weekly subscription caps, OpenCode Go usage cap, Codex/Gemini
 * quota — see `usage_limit`/`rate_limit`/`balance` in the SDK error
 * classifier), the turn should continue on the next available provider instead
 * of failing. This module is the pure policy that decides which one.
 *
 * It is intentionally side-effect free (no DB, no network) so it is trivially
 * testable and can run in the hot path of the streaming route. Availability is
 * derived from the same credential flags the rest of the app already computes
 * via `getEffectiveCredentialFlags`, so a user's own keys and the server's
 * shared pools are both honored automatically.
 */

import {
  agentModels,
  getDefaultModelForAgent,
  hasCredentialsForModel,
  type Agent,
  type CredentialFlags,
} from "@background-agents/common"

/**
 * Priority order for falling back. Fixed per product decision:
 * claude → opencode → codex → gemini. OpenCode sits second because its free
 * models need no key, making it the near-universal safety net.
 *
 * Only these four participate in auto-switch today; other agents are never
 * auto-selected (but a user can still pick them manually).
 */
export const FALLBACK_CHAIN: readonly Agent[] = [
  "claude-code",
  "opencode",
  "codex",
  "gemini",
]

export interface FallbackPick {
  agent: Agent
  /** Default model for that agent given the available credentials. */
  model: string
}

/**
 * Whether an agent can actually run a turn with the given credentials/pools.
 *
 * `getDefaultModelForAgent` returns the best model it can, but falls back to the
 * agent's nominal default even when no credential covers it — so we re-check the
 * resolved model against `hasCredentialsForModel` to avoid picking an agent the
 * user can't actually use.
 */
export function isAgentAvailable(
  agent: Agent,
  flags: CredentialFlags | null | undefined
): boolean {
  const model = getDefaultModelForAgent(agent, flags)
  const opt = (agentModels[agent] ?? []).find((m) => m.value === model)
  return opt ? hasCredentialsForModel(opt, flags, agent) : false
}

export interface PickFallbackArgs {
  /** The agent that just hit its limit (excluded from the result). */
  requested: Agent
  /** Effective credential flags (user keys + shared pools). */
  flags: CredentialFlags | null | undefined
  /**
   * Agents already tried and exhausted in this conversation/turn. The requested
   * agent is treated as exhausted implicitly; pass others here to avoid looping
   * back onto a provider that already failed.
   */
  exhausted?: ReadonlySet<Agent>
}

/**
 * Pick the next available provider in the fallback chain, or null when none of
 * the remaining providers can serve the turn (caller should then surface the
 * original limit error).
 */
export function pickFallbackAgent({
  requested,
  flags,
  exhausted,
}: PickFallbackArgs): FallbackPick | null {
  for (const agent of FALLBACK_CHAIN) {
    if (agent === requested) continue
    if (exhausted?.has(agent)) continue
    if (!isAgentAvailable(agent, flags)) continue
    return { agent, model: getDefaultModelForAgent(agent, flags) }
  }
  return null
}
