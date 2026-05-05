/**
 * Server-only credential flag resolution.
 * Must never be imported from client code.
 */

import { prisma } from "@/lib/db/prisma"
import { isSharedPoolAvailable } from "@/lib/claude-credentials"
import { hasExceededClaudeLimit, getDailyClaudeCodeLimit } from "@/lib/db/usage-limit"
import { decryptUserCredentials } from "@/lib/db/api-helpers"
import { flagsFromCredentials, type CredentialFlags } from "@/lib/credentials"

export interface EffectiveFlags {
  flags: CredentialFlags
  limitResetAt: Date | null
  limitRemaining: number | null
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
export async function getEffectiveCredentialFlags(userId: string): Promise<EffectiveFlags> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { credentials: true, isPro: true },
  })

  const decryptedCreds = decryptUserCredentials(
    user?.credentials as Record<string, unknown> | null
  )

  const flags = flagsFromCredentials(decryptedCreds)

  if (await isSharedPoolAvailable()) {
    flags.CLAUDE_SHARED_POOL_AVAILABLE = true
  }

  // Check daily limit only for free users who would use the shared pool
  // (no personal API key or subscription token)
  const hasOwnAnthropicKey = !!flags.ANTHROPIC_API_KEY || !!flags.CLAUDE_CODE_CREDENTIALS
  const usesSharedPool = flags.CLAUDE_SHARED_POOL_AVAILABLE && !hasOwnAnthropicKey

  let limitResetAt: Date | null = null
  let limitRemaining: number | null = null

  if (usesSharedPool && !user?.isPro) {
    const now = new Date()
    const exceeded = await hasExceededClaudeLimit(userId)
    flags.CLAUDE_DAILY_LIMIT_EXCEEDED = exceeded

    if (exceeded) {
      limitResetAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))
      limitRemaining = 0
    } else {
      const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
      const todayCount = await prisma.activityLog.count({
        where: {
          userId,
          action: "message_sent",
          createdAt: { gte: startOfDay },
          metadata: { path: ["useSharedClaude"], equals: true },
        },
      })
      limitRemaining = Math.max(0, getDailyClaudeCodeLimit() - todayCount)
      limitResetAt = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000)
    }
  }

  return { flags, limitResetAt, limitRemaining }
}
