import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import { microToUsd } from "@/lib/server/credits"
import { providerLabel, type ProviderName } from "@background-agents/common"
import { NEW_REPOSITORY } from "@/lib/types"

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
// (unique), which is how spend gets attributed to a provider, model, repo or
// chat. That uniqueness is also why the breakdowns can LEFT JOIN the ledger
// onto TokenUsage without the join fanning out and double-counting tokens.
// Raw SQL because `tokenUsageId` has no Prisma relation behind it, the same
// reason sumChatCreditsByProvider in lib/db/credits.ts uses it.

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

/** What slice of the account the figures describe. */
export type UsageScope =
  | { kind: "account" }
  | { kind: "repo"; repo: string }
  | { kind: "chat"; chatId: string }

/**
 * Parse the `scope` query param: "account", "repo:<owner/name>" or
 * "chat:<id>". Anything unrecognized falls back to the whole account.
 *
 * No ownership check is needed here: every query filters on the caller's
 * userId, so a scope naming someone else's repo or chat matches no rows and
 * returns an empty window rather than leaking anything.
 */
export function parseUsageScope(value: string | null): UsageScope {
  if (!value || value === "account") return { kind: "account" }
  if (value.startsWith("repo:")) {
    const repo = value.slice(5)
    return repo ? { kind: "repo", repo } : { kind: "account" }
  }
  if (value.startsWith("chat:")) {
    const chatId = value.slice(5)
    return chatId ? { kind: "chat", chatId } : { kind: "account" }
  }
  return { kind: "account" }
}

/** Serialize a scope back into its query-param form. */
export function formatUsageScope(scope: UsageScope): string {
  if (scope.kind === "repo") return `repo:${scope.repo}`
  if (scope.kind === "chat") return `chat:${scope.chatId}`
  return "account"
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

/** One row of a breakdown: an agent, model, repo or chat, and what it cost. */
export interface UsageBreakdownRow {
  /** Stable id — provider name, model id, "owner/repo", or a chat id. */
  key: string
  label: string
  creditsUsd: number
  tokens: number
  turns: number
}

/**
 * How the window's tokens were made up, and how much of them reached the
 * balance.
 *
 * The five parts are reported separately by tokscale and don't necessarily add
 * up to `totalTokens`, so anything drawing them as a whole should total the
 * parts rather than assume `totalTokens` is their sum.
 */
export interface UsageTokenMix {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  reasoning: number
  /** Tokens on turns that produced a debit — what the balance actually paid for. */
  chargedTokens: number
  /** Every token recorded in the window, charged or not. */
  totalTokens: number
}

/** The dimensions a breakdown can be sliced by. */
export type UsageDimension = "agent" | "model" | "repo" | "chat"

/** An entry the scope picker can offer. */
export interface UsageScopeOption {
  key: string
  label: string
}

export interface UserUsageSummary {
  range: UsageRange
  scope: string
  totals: UsageTotals
  daily: UsageDayPoint[]
  /** Providers with activity in the window, ranked by credits then tokens. */
  providers: string[]
  tokenMix: UsageTokenMix
  breakdowns: Record<UsageDimension, UsageBreakdownRow[]>
  /** Everything the scope picker can offer — always the whole account, so the
   *  picker can still get back out of a scope it is currently inside. */
  scopeOptions: { repos: UsageScopeOption[]; chats: UsageScopeOption[] }
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
 * Display name for a chat, with a date appended when it has no title.
 *
 * Untitled chats are common and otherwise identical, which makes a list of
 * them impossible to pick from. The date is a disambiguator rather than a
 * precise timestamp, so it is formatted in UTC with a pinned locale: the
 * point is that two rows differ, and that has to be deterministic regardless
 * of where the server runs.
 */
function chatLabel(displayName: string | null | undefined, createdAt: Date | null): string {
  if (displayName) return displayName
  if (!createdAt) return "Untitled chat"
  const day = createdAt.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })
  return `Untitled chat · ${day}`
}

/** Display name for a repo slug, including the "no repo yet" placeholder. */
function repoLabel(repo: string): string {
  return repo === NEW_REPOSITORY ? "No repository" : repo
}

/** Rows as the breakdown queries return them, before labelling. */
interface RawBreakdownRow {
  key: string | null
  label?: string | null
  createdAt?: Date | null
  tokens: bigint
  turns: bigint
  micro: bigint
}

function toBreakdownRows(
  rows: RawBreakdownRow[],
  label: (row: RawBreakdownRow) => string
): UsageBreakdownRow[] {
  return rows.map((row) => ({
    key: row.key ?? "",
    label: label(row),
    creditsUsd: microToUsd(row.micro),
    tokens: Number(row.tokens),
    turns: Number(row.turns),
  }))
}

/**
 * Everything the Usage tab needs for one user, one window and one scope.
 *
 * Each total query covers twice the window so the preceding period comes back
 * in the same pass, splitting on the boundary with a CASE rather than paying
 * for a second round trip per figure.
 */
export async function getUserUsageSummary(
  userId: string,
  range: UsageRange,
  scope: UsageScope = { kind: "account" }
): Promise<UserUsageSummary> {
  const days = usageRangeDays(range)
  const interval = `${days} days`
  const doubleInterval = `${days * 2} days`

  // The scope narrows on chat id, which both ledgers carry — so it never needs
  // a join, and a repo resolves to its chats through a subquery rather than
  // dragging Chat into every aggregate.
  const chatsInRepo = (repo: string) =>
    Prisma.sql`(SELECT "id" FROM "Chat" WHERE "userId" = ${userId} AND "repo" = ${repo})`
  const scopeOn = (column: Prisma.Sql) => {
    if (scope.kind === "repo") return Prisma.sql`AND ${column} IN ${chatsInRepo(scope.repo)}`
    if (scope.kind === "chat") return Prisma.sql`AND ${column} = ${scope.chatId}`
    return Prisma.empty
  }
  const scopeTu = scopeOn(Prisma.sql`tu."chatId"`)
  const scopeUsage = scopeOn(Prisma.sql`"chatId"`)
  const scopeLedger = scopeOn(Prisma.sql`"chatId"`)

  // Joining the ledger onto usage is safe because CreditTransaction.tokenUsageId
  // is unique: at most one debit per usage row, so tokens can't be doubled.
  const ledgerJoin = Prisma.sql`
    LEFT JOIN "CreditTransaction" ct
           ON ct."tokenUsageId" = tu."id" AND ct."type" = 'debit'`
  const measures = Prisma.sql`
    SUM(tu."totalTokens")::bigint AS tokens,
    COUNT(*)::bigint AS turns,
    COALESCE(SUM(-ct."amountMicroUsd"), 0)::bigint AS micro`
  const usageWindow = Prisma.sql`
    tu."userId" = ${userId} AND tu."createdAt" >= NOW() - ${interval}::interval`

  const [
    creditTotals,
    tokenTotals,
    creditsByDay,
    tokensByDay,
    mixRows,
    agentRows,
    modelRows,
    repoRows,
    chatRows,
  ] = await Promise.all([
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
        ${scopeLedger}
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
        ${scopeUsage}
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
         ${scopeTu}
       GROUP BY 1, 2
    `,
    prisma.$queryRaw<Array<{ day: Date; provider: string; tokens: bigint }>>`
      SELECT date_trunc('day', "createdAt")::date AS day,
             "provider" AS provider,
             SUM("totalTokens")::bigint AS tokens
        FROM "TokenUsage"
       WHERE "userId" = ${userId}
         AND "createdAt" >= NOW() - ${interval}::interval
         ${scopeUsage}
       GROUP BY 1, 2
    `,
    prisma.$queryRaw<
      Array<{
        input: bigint | null
        output: bigint | null
        cacheRead: bigint | null
        cacheWrite: bigint | null
        reasoning: bigint | null
        chargedTokens: bigint | null
        totalTokens: bigint | null
      }>
    >`
      SELECT SUM(tu."inputTokens")::bigint AS input,
             SUM(tu."outputTokens")::bigint AS output,
             SUM(tu."cacheReadTokens")::bigint AS "cacheRead",
             SUM(tu."cacheWriteTokens")::bigint AS "cacheWrite",
             SUM(tu."reasoningTokens")::bigint AS reasoning,
             SUM(tu."totalTokens") FILTER (WHERE ct."id" IS NOT NULL)::bigint AS "chargedTokens",
             SUM(tu."totalTokens")::bigint AS "totalTokens"
        FROM "TokenUsage" tu ${ledgerJoin}
       WHERE ${usageWindow} ${scopeTu}
    `,
    prisma.$queryRaw<RawBreakdownRow[]>`
      SELECT tu."provider" AS key, ${measures}
        FROM "TokenUsage" tu ${ledgerJoin}
       WHERE ${usageWindow} ${scopeTu}
       GROUP BY 1
       ORDER BY micro DESC, tokens DESC
    `,
    prisma.$queryRaw<RawBreakdownRow[]>`
      SELECT tu."model" AS key, ${measures}
        FROM "TokenUsage" tu ${ledgerJoin}
       WHERE ${usageWindow} ${scopeTu}
       GROUP BY 1
       ORDER BY micro DESC, tokens DESC
       LIMIT 50
    `,
    prisma.$queryRaw<RawBreakdownRow[]>`
      SELECT c."repo" AS key, ${measures}
        FROM "TokenUsage" tu
        JOIN "Chat" c ON c."id" = tu."chatId"
        ${ledgerJoin}
       WHERE ${usageWindow} ${scopeTu}
       GROUP BY 1
       ORDER BY micro DESC, tokens DESC
       LIMIT 50
    `,
    prisma.$queryRaw<RawBreakdownRow[]>`
      SELECT tu."chatId" AS key, c."displayName" AS label,
             c."createdAt" AS "createdAt", ${measures}
        FROM "TokenUsage" tu
        JOIN "Chat" c ON c."id" = tu."chatId"
        ${ledgerJoin}
       WHERE ${usageWindow} ${scopeTu}
       GROUP BY 1, 2, 3
       ORDER BY micro DESC, tokens DESC
       LIMIT 50
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

  const mix = mixRows[0]
  const tokenMix: UsageTokenMix = {
    input: Number(mix?.input ?? 0n),
    output: Number(mix?.output ?? 0n),
    cacheRead: Number(mix?.cacheRead ?? 0n),
    cacheWrite: Number(mix?.cacheWrite ?? 0n),
    reasoning: Number(mix?.reasoning ?? 0n),
    chargedTokens: Number(mix?.chargedTokens ?? 0n),
    totalTokens: Number(mix?.totalTokens ?? 0n),
  }

  const breakdowns: Record<UsageDimension, UsageBreakdownRow[]> = {
    agent: toBreakdownRows(agentRows, (r) => providerLabel((r.key ?? "") as ProviderName)),
    model: toBreakdownRows(modelRows, (r) => r.key || "Unknown model"),
    repo: toBreakdownRows(repoRows, (r) => repoLabel(r.key ?? "")),
    chat: toBreakdownRows(chatRows, (r) => chatLabel(r.label, r.createdAt ?? null)),
  }

  // The picker has to list what the account has, not what the current scope
  // has — otherwise scoping into a chat would empty the very control needed to
  // scope back out. Only fetched separately when a scope is actually applied;
  // unscoped, the breakdowns above already are the whole account.
  const scopeOptions =
    scope.kind === "account"
      ? {
          repos: breakdowns.repo.map((r) => ({ key: r.key, label: r.label })),
          chats: breakdowns.chat.map((r) => ({ key: r.key, label: r.label })),
        }
      : await getScopeOptions(userId, interval)

  return {
    range,
    scope: formatUsageScope(scope),
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
    tokenMix,
    breakdowns,
    scopeOptions,
  }
}

/** Account-wide repos and chats with activity in the window, for the picker. */
async function getScopeOptions(
  userId: string,
  interval: string
): Promise<{ repos: UsageScopeOption[]; chats: UsageScopeOption[] }> {
  const [repos, chats] = await Promise.all([
    prisma.$queryRaw<Array<{ key: string; weight: bigint }>>`
      SELECT c."repo" AS key, SUM(tu."totalTokens")::bigint AS weight
        FROM "TokenUsage" tu
        JOIN "Chat" c ON c."id" = tu."chatId"
       WHERE tu."userId" = ${userId} AND tu."createdAt" >= NOW() - ${interval}::interval
       GROUP BY 1
       ORDER BY weight DESC
       LIMIT 50
    `,
    prisma.$queryRaw<
      Array<{ key: string; label: string | null; createdAt: Date | null; weight: bigint }>
    >`
      SELECT tu."chatId" AS key, c."displayName" AS label,
             c."createdAt" AS "createdAt",
             SUM(tu."totalTokens")::bigint AS weight
        FROM "TokenUsage" tu
        JOIN "Chat" c ON c."id" = tu."chatId"
       WHERE tu."userId" = ${userId} AND tu."createdAt" >= NOW() - ${interval}::interval
       GROUP BY 1, 2, 3
       ORDER BY weight DESC
       LIMIT 50
    `,
  ])
  return {
    repos: repos.map((r) => ({ key: r.key, label: repoLabel(r.key) })),
    chats: chats.map((c) => ({ key: c.key, label: chatLabel(c.label, c.createdAt) })),
  }
}
