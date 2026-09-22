import { prisma } from "@/lib/db/prisma"
import { microToUsd } from "@/lib/server/credits"

// =============================================================================
// Per-user usage rollups for the Usage settings tab
// =============================================================================
// Two sources, deliberately not interchangeable:
//
//   Money  → CreditTransaction debits. This is what actually left the balance,
//            so the numbers here reconcile with the balance the user is shown.
//   Tokens → TokenUsage. Its `costUsd` is API list value, which at the current
//            pricing multipliers overstates what a turn cost the user by up to
//            20× for Claude — so it is never used as money here.
//
// A debit joins 1:1 to the usage row that caused it through `tokenUsageId`
// (unique), which is how spend gets attributed to a provider. Raw SQL because
// that column has no Prisma relation behind it, the same reason
// sumChatCreditsByProvider in lib/db/credits.ts uses raw SQL.

/** Ranges the Usage tab offers. */
export type UsageRange = "7d" | "30d" | "90d"

const RANGE_DAYS: Record<UsageRange, number> = { "7d": 7, "30d": 30, "90d": 90 }

/** Days covered by a range. */
export function usageRangeDays(range: UsageRange): number {
  return RANGE_DAYS[range]
}

/** Parse the `range` query param, falling back for anything unrecognized. */
export function parseUsageRange(value: string | null, fallback: UsageRange): UsageRange {
  return value === "7d" || value === "30d" || value === "90d" ? value : fallback
}

/** One day of the series, provider-keyed. Providers absent that day are omitted. */
export interface UsageDayPoint {
  /** Calendar day, YYYY-MM-DD, in UTC. */
  date: string
  /** Credits debited that day, per provider, in USD. */
  credits: Record<string, number>
  /** Tokens recorded that day, per provider. */
  tokens: Record<string, number>
}

/** Headline figures, each alongside the preceding window of equal length. */
export interface UsageTotals {
  creditsUsd: number
  prevCreditsUsd: number
  tokens: number
  prevTokens: number
  turns: number
  prevTurns: number
}

export interface UserUsageSummary {
  range: UsageRange
  totals: UsageTotals
  daily: UsageDayPoint[]
  /** Providers with activity in the window, ranked by credits then tokens. */
  providers: string[]
}

/** YYYY-MM-DD for a Date, in UTC — the key the daily series is built on. */
function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/**
 * Every calendar day in the window, oldest first, so quiet days render as gaps
 * in the chart rather than disappearing and compressing the time axis.
 */
function denseDays(days: number): string[] {
  const out: string[] = []
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setUTCDate(d.getUTCDate() - i)
    out.push(dayKey(d))
  }
  return out
}

/**
 * Everything the Usage tab needs for one user and one window.
 *
 * Each query covers twice the window so the preceding period comes back in the
 * same pass, splitting on the boundary with a CASE rather than paying for a
 * second round trip per figure.
 */
export async function getUserUsageSummary(
  userId: string,
  range: UsageRange
): Promise<UserUsageSummary> {
  const days = usageRangeDays(range)
  const interval = `${days} days`
  const doubleInterval = `${days * 2} days`

  const [creditTotals, tokenTotals, creditsByDay, tokensByDay] = await Promise.all([
    // Money: every debit counts, no join needed — this must agree with the
    // balance, so it deliberately does not filter on anything.
    prisma.$queryRaw<Array<{ cur: bigint | null; prev: bigint | null }>>`
      SELECT
        SUM(CASE WHEN "createdAt" >= NOW() - ${interval}::interval
                 THEN -"amountMicroUsd" ELSE 0 END)::bigint AS cur,
        SUM(CASE WHEN "createdAt" <  NOW() - ${interval}::interval
                 THEN -"amountMicroUsd" ELSE 0 END)::bigint AS prev
      FROM "CreditTransaction"
      WHERE "userId" = ${userId}
        AND "type" = 'debit'
        AND "createdAt" >= NOW() - ${doubleInterval}::interval
    `,
    prisma.$queryRaw<
      Array<{ cur: bigint | null; prev: bigint | null; curTurns: bigint; prevTurns: bigint }>
    >`
      SELECT
        SUM(CASE WHEN "createdAt" >= NOW() - ${interval}::interval
                 THEN "totalTokens" ELSE 0 END)::bigint AS cur,
        SUM(CASE WHEN "createdAt" <  NOW() - ${interval}::interval
                 THEN "totalTokens" ELSE 0 END)::bigint AS prev,
        COUNT(*) FILTER (WHERE "createdAt" >= NOW() - ${interval}::interval)::bigint AS "curTurns",
        COUNT(*) FILTER (WHERE "createdAt" <  NOW() - ${interval}::interval)::bigint AS "prevTurns"
      FROM "TokenUsage"
      WHERE "userId" = ${userId}
        AND "createdAt" >= NOW() - ${doubleInterval}::interval
    `,
    prisma.$queryRaw<Array<{ day: Date; provider: string; micro: bigint }>>`
      SELECT date_trunc('day', t."createdAt")::date AS day,
             tu."provider" AS provider,
             SUM(-t."amountMicroUsd")::bigint AS micro
        FROM "CreditTransaction" t
        JOIN "TokenUsage" tu ON tu."id" = t."tokenUsageId"
       WHERE t."userId" = ${userId}
         AND t."type" = 'debit'
         AND t."createdAt" >= NOW() - ${interval}::interval
       GROUP BY 1, 2
    `,
    prisma.$queryRaw<Array<{ day: Date; provider: string; tokens: bigint }>>`
      SELECT date_trunc('day', "createdAt")::date AS day,
             "provider" AS provider,
             SUM("totalTokens")::bigint AS tokens
        FROM "TokenUsage"
       WHERE "userId" = ${userId}
         AND "createdAt" >= NOW() - ${interval}::interval
       GROUP BY 1, 2
    `,
  ])

  // Index the grouped rows by day so the dense series can be filled in one pass.
  // The grouping itself is SQL's job; this only densifies a result bounded by
  // 90 days × the provider count.
  const creditsIndex = new Map<string, Record<string, number>>()
  const tokensIndex = new Map<string, Record<string, number>>()
  const creditsByProvider = new Map<string, number>()
  const tokensByProvider = new Map<string, number>()

  for (const row of creditsByDay) {
    const key = dayKey(row.day)
    const bucket = creditsIndex.get(key) ?? {}
    const usd = microToUsd(row.micro)
    bucket[row.provider] = (bucket[row.provider] ?? 0) + usd
    creditsIndex.set(key, bucket)
    creditsByProvider.set(row.provider, (creditsByProvider.get(row.provider) ?? 0) + usd)
  }
  for (const row of tokensByDay) {
    const key = dayKey(row.day)
    const bucket = tokensIndex.get(key) ?? {}
    const tokens = Number(row.tokens)
    bucket[row.provider] = (bucket[row.provider] ?? 0) + tokens
    tokensIndex.set(key, bucket)
    tokensByProvider.set(row.provider, (tokensByProvider.get(row.provider) ?? 0) + tokens)
  }

  const daily: UsageDayPoint[] = denseDays(days).map((date) => ({
    date,
    credits: creditsIndex.get(date) ?? {},
    tokens: tokensIndex.get(date) ?? {},
  }))

  // Rank by spend first, tokens second: a provider the user paid for outranks a
  // chatty free one. This is the order a caller gets if it doesn't re-rank —
  // the daily chart does re-rank, by whichever metric is on screen, since
  // colour is pinned per agent and only the legend order moves.
  const providers = [...new Set([...creditsByProvider.keys(), ...tokensByProvider.keys()])].sort(
    (a, b) =>
      (creditsByProvider.get(b) ?? 0) - (creditsByProvider.get(a) ?? 0) ||
      (tokensByProvider.get(b) ?? 0) - (tokensByProvider.get(a) ?? 0)
  )

  return {
    range,
    totals: {
      creditsUsd: microToUsd(creditTotals[0]?.cur ?? 0n),
      prevCreditsUsd: microToUsd(creditTotals[0]?.prev ?? 0n),
      tokens: Number(tokenTotals[0]?.cur ?? 0n),
      prevTokens: Number(tokenTotals[0]?.prev ?? 0n),
      turns: Number(tokenTotals[0]?.curTurns ?? 0n),
      prevTurns: Number(tokenTotals[0]?.prevTurns ?? 0n),
    },
    daily,
    providers,
  }
}
