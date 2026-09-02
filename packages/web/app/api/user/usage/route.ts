import { requireAuth, isAuthError, internalError, decryptUserCredentials } from "@/lib/db/api-helpers"
import { prisma } from "@/lib/db/prisma"
import { sumSharedSpendByProvider } from "@/lib/db/token-usage"
import {
  SHARED_POOL_AGENTS,
  providerForAgent,
  resolvePool,
} from "@/lib/server/shared-pool"
import {
  getDailyBalance,
  getStartOfUtcDay,
  getNextUtcDayReset,
  type Plan,
} from "@/lib/server/usage-budgets"
import { agentLabels, type Agent } from "@background-agents/common"

/** One shared pool's contribution to today's spend. */
export interface PoolUsage {
  agent: Agent
  provider: string
  label: string
  /** What this pool has drawn today, in USD. */
  used: number
  /** True when the user has their own key for this provider (pool unused). */
  ownKey: boolean
}

export interface UsageResponse {
  /** The user's subscription tier. */
  plan: Plan
  /** ISO timestamp of the next daily reset (UTC midnight). */
  resetAt: string
  /** Spent today across every shared pool, in USD. */
  used: number
  /** Daily balance in USD, or null when uncapped (`unlimited` plan). */
  limit: number | null
  /** Per-pool breakdown of `used`, for the detail under the bar. */
  pools: PoolUsage[]
}

// =============================================================================
// GET - today's spend for the current user, with a per-pool breakdown
// =============================================================================

export async function GET(): Promise<Response> {
  const authResult = await requireAuth()
  if (isAuthError(authResult)) return authResult
  const { userId } = authResult

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { plan: true, credentials: true },
    })
    const plan: Plan = user?.plan ?? "free"
    const storedCreds = decryptUserCredentials(
      user?.credentials as Record<string, unknown> | null
    )
    const since = getStartOfUtcDay()

    // One grouped query for the whole breakdown, rather than one per provider.
    const byProvider = await sumSharedSpendByProvider({ userId, since })

    const pools: PoolUsage[] = SHARED_POOL_AGENTS.map((agent) => {
      const provider = providerForAgent(agent)
      return {
        agent,
        provider,
        label: agentLabels[agent],
        used: byProvider[provider] ?? 0,
        ownKey: resolvePool(agent, storedCreds) === "user",
      }
    })

    const response: UsageResponse = {
      plan,
      resetAt: getNextUtcDayReset().toISOString(),
      used: Object.values(byProvider).reduce((a, b) => a + b, 0),
      limit: getDailyBalance(plan),
      pools,
    }
    return Response.json(response)
  } catch (error) {
    return internalError(error)
  }
}
