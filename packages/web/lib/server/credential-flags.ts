/**
 * Server-only credential flag resolution.
 * Must never be imported from client code.
 */

import { prisma } from "@/lib/db/prisma"
import { isSharedPoolAvailable } from "@/lib/claude-credentials"
import { sumSharedSpend } from "@/lib/db/token-usage"
import { decryptUserCredentials } from "@/lib/db/api-helpers"
import {
  getDailyBalance,
  getStartOfUtcDay,
  getNextUtcDayReset,
  getStartOfUtcWeek,
  getNextUtcWeekReset,
  type Plan,
} from "@/lib/server/usage-budgets"
import { flagsFromCredentials, CREDENTIAL_KEYS, type CredentialFlags } from "@/lib/credentials"
import { hasSharedOpencodeKey } from "@/lib/server/opencode-pool"
import { SHARED_POOL_AGENTS } from "@/lib/server/shared-pool"
import { agentUsesSharedPool } from "@background-agents/common"

export interface EffectiveFlags {
  flags: CredentialFlags
  limitResetAt: Date | null
  /** Balance remaining for capped plans; null = unlimited. */
  limitRemaining: number | null
  /** Spent across the shared pools this period (daily capped / weekly unlimited). */
  limitUsed: number | null
  /** Daily balance for capped plans (free/pro); null when unlimited. */
  limitTotal: number | null
  /** Whether usage is tracked weekly (unlimited plan) vs daily (free/pro) */
  isWeekly: boolean
  /** Whether the user has a paid plan (pro or unlimited) */
  isPro: boolean
  /** The user's subscription tier. */
  plan: Plan
}

/**
 * Build effective credential flags for a user, including the daily Claude limit status.
 *
 * This is the single entry point for server-side flag resolution. It combines:
 * - Stored credentials
 * - Shared pool availability
 * - Daily limit check (only for free users using shared credentials)
 *
 * The resulting flags can be passed directly to getDefaultAgent/hasCredentialsForModel.
 */
/**
 * Server-config-only credential flags — the shared pools available to everyone,
 * derived purely from server env / rotating credential state with no user
 * context. Safe to expose to logged-out visitors so the agent picker can show
 * the shared-pool "ready" dots (Claude Code, Gemini, OpenCode) before sign-in.
 *
 * Only booleans about server configuration are returned — never key values.
 * getEffectiveCredentialFlags layers the user's own stored credentials and the
 * daily-limit state on top of these same signals for an authenticated user.
 */
export async function getSharedPoolFlags(): Promise<CredentialFlags> {
  const flags: CredentialFlags = {}

  // Server env keys back the shared OpenCode / Gemini pools. Mark both the
  // presence flag (so hasCredentialsForModel treats the provider as available)
  // and the `_SHARED` origin flag (so the UI knows it isn't a user-owned key).
  if (hasSharedOpencodeKey()) {
    flags.OPENCODE_API_KEY = true
    flags.OPENCODE_API_KEY_SHARED = true
  }
  if (process.env.GEMINI_API_KEY) {
    flags.GEMINI_API_KEY = true
    flags.GEMINI_API_KEY_SHARED = true
  }
  if (await isSharedPoolAvailable()) {
    flags.CLAUDE_SHARED_POOL_AVAILABLE = true
  }

  return flags
}

export async function getEffectiveCredentialFlags(userId: string): Promise<EffectiveFlags> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { credentials: true, plan: true, creditBalanceMicroUsd: true },
  })

  // Decrypt stored credentials (only those the user has saved)
  const storedCreds = decryptUserCredentials(
    user?.credentials as Record<string, unknown> | null
  )

  // Build the full credentials map by falling back to process.env for any
  // missing values. This map is used elsewhere (not for origin detection).
  const decryptedCreds = { ...storedCreds }
  for (const { id } of CREDENTIAL_KEYS) {
    if (!decryptedCreds[id] && process.env[id]) {
      decryptedCreds[id] = process.env[id]
    }
  }

  // Build flags from the stored (user-provided) credentials so we can
  // distinguish between user-owned keys and server-shared env keys.
  const flags = flagsFromCredentials(storedCreds)

  // Special-case: mark whether OPENCODE_API_KEY comes from the user's stored
  // credentials (user-owned) or only from the server environment (shared).
  const opencodeFromDb = !!storedCreds.OPENCODE_API_KEY
  const opencodeFromEnv = !opencodeFromDb && hasSharedOpencodeKey()
  flags.OPENCODE_API_KEY_USER = opencodeFromDb
  flags.OPENCODE_API_KEY_SHARED = opencodeFromEnv
  // Preserve the conventional boolean presence flag for callers that expect it
  flags.OPENCODE_API_KEY = opencodeFromDb || opencodeFromEnv

  // Same for GEMINI_API_KEY: a server env key (shared pool) should make Gemini
  // show as available in the UI, not prompt for a key. Pool origin (shared vs
  // user) is still resolved separately from stored creds, so flagging the env
  // key here doesn't make it count as user-owned.
  const geminiFromDb = !!storedCreds.GEMINI_API_KEY
  const geminiFromEnv = !geminiFromDb && !!process.env.GEMINI_API_KEY
  flags.GEMINI_API_KEY_USER = geminiFromDb
  flags.GEMINI_API_KEY_SHARED = geminiFromEnv
  flags.GEMINI_API_KEY = geminiFromDb || geminiFromEnv

  if (await isSharedPoolAvailable()) {
    flags.CLAUDE_SHARED_POOL_AVAILABLE = true
  }

  // The balance is pooled across every shared pool, so track it for anyone who
  // draws on at least one of them. A user with their own key everywhere spends
  // nothing and gets no balance display.
  const usesSharedPool = SHARED_POOL_AGENTS.some((agent) =>
    agentUsesSharedPool(agent, flags)
  )
  const plan: Plan = user?.plan ?? "free"
  const isPro = plan !== "free"
  const credits = user?.creditBalanceMicroUsd ?? 0n

  let limitResetAt: Date | null = null
  let limitRemaining: number | null = null
  let limitUsed: number | null = null
  let limitTotal: number | null = null
  let isWeekly = false

  if (usesSharedPool) {
    const allowance = getDailyBalance(plan)

    if (allowance == null) {
      // Unlimited plan: weekly spend for display only — no cap, and it never
      // touches credits, so SHARED_BALANCE_EXHAUSTED is never set here.
      isWeekly = true
      limitUsed = await sumSharedSpend({ userId, since: getStartOfUtcWeek() })
      limitResetAt = getNextUtcWeekReset()
      // limitTotal / limitRemaining stay null (unlimited)
    } else {
      // Free and Pro, identically: `used`/`limitTotal`/`limitRemaining` below
      // are still computed for the Settings usage bar, but readiness
      // (SHARED_BALANCE_EXHAUSTED) reflects the purchased-credit balance —
      // the actual thing that gates a send now — not the daily numbers.
      const used = await sumSharedSpend({ userId, since: getStartOfUtcDay() })
      limitUsed = used
      limitResetAt = getNextUtcDayReset()
      limitTotal = allowance
      limitRemaining = Math.max(0, allowance - used)
      flags.SHARED_BALANCE_EXHAUSTED = credits <= 0n
    }
  }

  return {
    flags,
    limitResetAt,
    limitRemaining,
    limitUsed,
    limitTotal,
    isPro,
    isWeekly,
    plan,
  }
}
