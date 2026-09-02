/**
 * The daily spending balance for the shared credential pools.
 *
 * Free users get a daily balance, denominated in US dollars of API list value,
 * spent across every shared pool (Claude OAuth / Gemini / OpenCode server keys)
 * rather than budgeted per provider. Pro gets the same balance scaled by
 * PRO_BUDGET_MULTIPLIER; only `unlimited`-plan users, and anyone running on
 * their own key, are uncapped. Spending is summed from the TokenUsage ledger
 * (populated post-turn by tokscale metering).
 *
 * Because a turn's cost is only known after it runs, enforcement is post-hoc:
 * we block the NEXT turn once the day's spending has met the allowance. That
 * means one turn can overshoot — a single agentic run has been observed at $476
 * — and nothing here bounds that. The blast radius is one day, since the
 * allowance resets at UTC midnight and nothing carries over.
 */

import type { Agent, ProviderName } from "@background-agents/common"

import { prisma } from "./prisma"
import { sumSharedSpend } from "./token-usage"
import { providerForRun, resolvePool } from "@/lib/server/shared-pool"
import { decryptUserCredentials } from "./api-helpers"
import { formatUsageLimitMessage } from "@/lib/usage-limit-copy"
import {
  getDailyBalance,
  getNextUtcDayReset,
  getStartOfUtcDay,
  type Plan,
} from "@/lib/server/usage-budgets"

export interface UsageLimitResult {
  allowed: boolean
  plan: Plan
  /** Provider this run would have been billed to — for logging and telemetry. */
  provider: ProviderName
  /** "shared" pools draw the balance; "user" pools are always allowed. */
  pool: "shared" | "user"
  /** Spent today, across every shared pool. */
  used: number
  /** Daily balance (Free/Pro), or null for Unlimited/own-key runs. */
  limit: number | null
  remaining: number | null
  resetAt: Date
  error?: string
}

/**
 * Check whether a user may start a turn on `agent` given their daily
 * balance. Uncapped (allowed, no limit) when: the agent has no shared pool,
 * the user supplied their own key for it, or the user is on the `unlimited`
 * plan. Free and Pro are capped (Pro at PRO_BUDGET_MULTIPLIER× free).
 *
 * Note the asymmetry, and that it is deliberate: whether *this* run is metered
 * depends on the agent and model being used right now, but how much has been
 * *spent* is pooled across every shared provider. So a user who spent their
 * balance on Claude is blocked on Gemini too — unless they have their own
 * Gemini key, in which case this run resolves to the "user" pool and is allowed.
 */
export async function checkSharedPoolUsage(
  userId: string,
  agent: Agent,
  model?: string
): Promise<UsageLimitResult> {
  const provider = providerForRun(agent, model)
  const resetAt = getNextUtcDayReset()

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { plan: true, credentials: true },
  })

  const plan: Plan = user?.plan ?? "free"
  const storedCreds = decryptUserCredentials(
    user?.credentials as Record<string, unknown> | null
  )
  // resolvePool folds in the model: custom endpoints and own-key runs read as
  // "user" (never limited), and a Gemini model under a BYOK agent (Pi, Droid)
  // reads as the shared Gemini pool.
  const pool = resolvePool(agent, storedCreds, model)

  const base = { plan, provider, pool, used: 0, resetAt }

  // Not a shared-pool run → uncapped. resolvePool returns "shared" only for a
  // genuine shared-pool run (incl. a Gemini model under Pi/Droid), so gating on
  // the resolved pool covers every case without an agent allowlist.
  if (pool === "user") {
    return { ...base, allowed: true, limit: null, remaining: null }
  }

  const allowance = getDailyBalance(plan)
  if (allowance == null) {
    // Unlimited plan ⇒ uncapped.
    return { ...base, allowed: true, limit: null, remaining: null }
  }

  const used = await sumSharedSpend({ userId, since: getStartOfUtcDay() })
  const remaining = Math.max(0, allowance - used)
  const allowed = used < allowance

  return {
    ...base,
    allowed,
    used,
    limit: allowance,
    remaining,
    error: allowed ? undefined : formatUsageLimitMessage({ plan, limit: allowance }),
  }
}
