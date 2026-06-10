/**
 * Provider limit cache.
 *
 * When an upstream provider reports its own limit exhausted, we remember it
 * (with the reset time parsed from the message when available) so the NEXT
 * message can skip that provider proactively — instead of wasting a turn
 * rediscovering the limit and then switching reactively.
 *
 * Storage piggybacks on `activityLog` (a `provider_limited` row per hit) so no
 * schema migration is needed. "Currently limited" = the most recent row for
 * (user, agent) whose `limitedUntil` is still in the future.
 */

import { prisma } from "@/lib/db/prisma"
import { logActivity } from "@/lib/db/activity-log"
import { agentLabels, getModelLabel, type Agent } from "@background-agents/common"

/** Cooldown used when the message carries no parseable reset time. */
const DEFAULT_COOLDOWN_MS = 60 * 60 * 1000 // 1 hour
/** Safety ceiling so a mis-parsed far-future time can't pin a provider off. */
const MAX_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000 // 1 week

/**
 * Best-effort parse of a provider's limit-reset time from its message. Handles
 * Claude Code's "resets 11am (UTC)" / "resets at 23:00", ISO 8601 timestamps,
 * and unix epochs. Returns null when nothing parseable is found.
 *
 * `now` is injectable for testing.
 */
export function parseResetTime(message: string, now: Date = new Date()): Date | null {
  if (!message) return null

  // ISO 8601 timestamp anywhere in the string.
  const iso = message.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?Z?/)
  if (iso) {
    const d = new Date(iso[0])
    if (!isNaN(d.getTime())) return d
  }

  // Unix epoch (10-digit seconds or 13-digit ms).
  const epoch = message.match(/\b(\d{13}|\d{10})\b/)
  if (epoch) {
    const raw = Number(epoch[0])
    const d = new Date(epoch[0].length === 13 ? raw : raw * 1000)
    if (!isNaN(d.getTime())) return d
  }

  // Clock time: "resets 11am (UTC)", "resets at 11:00", "resets 3 pm".
  // Claude states these in UTC, so interpret as the next UTC occurrence.
  const clock = message.match(/resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*([ap]m)?/i)
  if (clock) {
    let hour = parseInt(clock[1], 10)
    const minute = clock[2] ? parseInt(clock[2], 10) : 0
    const ampm = clock[3]?.toLowerCase()
    if (ampm === "pm" && hour < 12) hour += 12
    if (ampm === "am" && hour === 12) hour = 0
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      const reset = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, minute, 0)
      )
      // If that time already passed today, it's tomorrow's reset.
      if (reset.getTime() <= now.getTime()) reset.setUTCDate(reset.getUTCDate() + 1)
      return reset
    }
  }

  return null
}

/** Resolve the time a provider should be treated as limited until. */
export function resolveLimitedUntil(message: string, now: Date = new Date()): Date {
  const parsed = parseResetTime(message, now)
  if (parsed) {
    const ms = parsed.getTime() - now.getTime()
    if (ms > 0 && ms <= MAX_COOLDOWN_MS) return parsed
  }
  return new Date(now.getTime() + DEFAULT_COOLDOWN_MS)
}

/**
 * Record that `agent` hit its upstream limit for this user. Returns the time it
 * will be considered available again. Best-effort — never throws.
 */
export async function recordProviderLimit(
  userId: string,
  agent: Agent,
  message: string
): Promise<Date> {
  const limitedUntil = resolveLimitedUntil(message)
  await logActivity(userId, "provider_limited", {
    agent,
    limitedUntil: limitedUntil.toISOString(),
    reason: message.slice(0, 300),
  })
  return limitedUntil
}

/**
 * Return the time `agent` is limited until for this user, or null if it is not
 * currently limited (no record, or the most recent one has already reset).
 */
export async function getProviderLimitedUntil(
  userId: string,
  agent: Agent
): Promise<Date | null> {
  const row = await prisma.activityLog.findFirst({
    where: {
      userId,
      action: "provider_limited",
      metadata: { path: ["agent"], equals: agent },
    },
    orderBy: { createdAt: "desc" },
    select: { metadata: true },
  })
  const meta = row?.metadata as { limitedUntil?: string } | null
  if (!meta?.limitedUntil) return null
  const until = new Date(meta.limitedUntil)
  if (isNaN(until.getTime()) || until.getTime() <= Date.now()) return null
  return until
}

/** Shared copy for the inline "switched provider" notice (reactive + proactive). */
export function switchNoticeContent(
  fromAgent: Agent,
  toAgent: Agent,
  model: string,
  opts?: { proactive?: boolean }
): string {
  const from = agentLabels[fromAgent] ?? fromAgent
  const to = agentLabels[toAgent] ?? toAgent
  const modelLabel = getModelLabel(toAgent, model)
  return opts?.proactive
    ? `${from} is at its usage limit — using ${to} (${modelLabel}) instead.`
    : `${from} hit its usage limit — continued on ${to} (${modelLabel}).`
}
