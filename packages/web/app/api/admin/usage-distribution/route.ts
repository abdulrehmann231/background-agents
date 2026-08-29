import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import { requireAdmin, isAuthError } from "@/lib/db/api-helpers"
import { getRangeInterval, parseFiniteTimeRange } from "@/lib/db/time-range"
import {
  getProviderBudget,
  PRO_BUDGET_MULTIPLIER,
  type BudgetUnit,
} from "@/lib/server/usage-budgets"

// Providers with a configured shared pool + budget. Fixed whitelist — the value
// reaches SQL as a bound parameter, never as interpolated text.
const VALID_PROVIDERS = ["claude", "opencode", "gemini"] as const
type Provider = (typeof VALID_PROVIDERS)[number]

/**
 * The ledger column a provider's budget is denominated in. Mirrors
 * FREE_DAILY_BUDGETS in usage-budgets.ts — tokens are cache-excluded (the same
 * `limitedTokens` measure the limiter enforces), cost is USD, and messages are
 * distinct assistant turns.
 */
function valueExpr(unit: BudgetUnit): Prisma.Sql {
  switch (unit) {
    case "cost":
      return Prisma.sql`SUM("costUsd")::float`
    case "messages":
      return Prisma.sql`COUNT(DISTINCT "messageId")::float`
    default:
      return Prisma.sql`SUM("inputTokens" + "outputTokens" + "reasoningTokens")::float`
  }
}

/**
 * GET /api/admin/usage-distribution
 *
 * Feeds the tier-limit tooling on the admin Overview. Returns one dataset that
 * the client derives the histogram, percentiles and limit simulation from, so
 * dragging the simulated limit costs no round-trips.
 *
 * Query params:
 *   - range:    "24h" | "7d" | "30d" (default "30d")
 *   - provider: "claude" | "opencode" | "gemini" (default "opencode")
 *   - excludeAdmins: "false" to include admin accounts (default: exclude)
 *
 * `perUser` is SHARED-POOL ONLY — a limit exists to protect the platform's own
 * credentials, so simulating one against BYOK usage would be meaningless. The
 * `poolSplit` series reports both pools precisely so that contrast is visible.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin()
  if (isAuthError(auth)) return auth

  const { searchParams } = new URL(request.url)
  const range = parseFiniteTimeRange(searchParams.get("range"), "30d")
  const providerParam = searchParams.get("provider")
  const provider: Provider = VALID_PROVIDERS.includes(providerParam as Provider)
    ? (providerParam as Provider)
    : "opencode"
  const excludeAdmins = searchParams.get("excludeAdmins") !== "false"
  const interval = getRangeInterval(range)

  const budget = getProviderBudget(provider, "free")
  const unit: BudgetUnit = budget?.unit ?? "tokens"
  const value = valueExpr(unit)

  // Free models are excluded from shared-pool budgets by the limiter
  // (sumSharedUsage), so they must be excluded here too — otherwise the
  // simulation would charge users for usage a real limit never counts.
  const sharedOnly = Prisma.sql`AND "pool" = 'shared' AND "freeModel" = false`
  const notAdmin = Prisma.sql`
    AND (${excludeAdmins} = false OR "userId" NOT IN (SELECT id FROM "User" WHERE "isAdmin" = true))
  `

  // --- Per-user × per-day matrix (shared pool) -----------------------------
  const perUserRawPromise = prisma.$queryRaw<
    Array<{ userId: string; name: string | null; image: string | null; day: Date; value: number }>
  >`
    SELECT
      tu."userId"        as "userId",
      u.name             as name,
      u.image            as image,
      date_trunc('day', tu."createdAt")::date as day,
      ${value}           as value
    FROM "TokenUsage" tu
    JOIN "User" u ON u.id = tu."userId"
    WHERE tu."createdAt" >= NOW() - ${interval}::interval
      AND tu.provider = ${provider}
      AND tu."pool" = 'shared'
      AND tu."freeModel" = false
      AND (${excludeAdmins} = false OR u."isAdmin" = false)
    GROUP BY tu."userId", u.name, u.image, 3
  `

  // --- Shared vs own-key over time ------------------------------------------
  const poolSplitPromise = prisma.$queryRaw<
    Array<{ day: Date; pool: string; value: number }>
  >`
    SELECT
      date_trunc('day', "createdAt")::date as day,
      "pool" as pool,
      ${value} as value
    FROM "TokenUsage"
    WHERE "createdAt" >= NOW() - ${interval}::interval
      AND provider = ${provider}
      ${notAdmin}
    GROUP BY 1, 2
    ORDER BY 1 ASC
  `

  // --- Per-key over time (OpenCode only) ------------------------------------
  // Rows written before per-key attribution have a null keyId; they surface as
  // "unattributed" rather than being dropped, so totals still reconcile.
  const byKeyPromise: Promise<Array<{ day: Date; keyId: string | null; value: number }>> =
    provider === "opencode"
      ? prisma.$queryRaw<Array<{ day: Date; keyId: string | null; value: number }>>`
          SELECT
            date_trunc('day', "createdAt")::date as day,
            "keyId" as "keyId",
            ${value} as value
          FROM "TokenUsage"
          WHERE "createdAt" >= NOW() - ${interval}::interval
            AND provider = ${provider}
            ${sharedOnly}
            ${notAdmin}
          GROUP BY 1, 2
          ORDER BY 1 ASC
        `
      : Promise.resolve([])

  const [perUserRaw, poolSplitRaw, byKeyRaw] = await Promise.all([
    perUserRawPromise,
    poolSplitPromise,
    byKeyPromise,
  ])

  // --- Build the aligned day axis -------------------------------------------
  // Generated in JS rather than SQL so all three series share one axis and the
  // client can index `daily[]` positionally against `days[]`.
  const days: string[] = []
  const today = new Date()
  const dayCount = range === "24h" ? 1 : range === "7d" ? 7 : 30
  for (let i = dayCount - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setUTCDate(d.getUTCDate() - i)
    days.push(d.toISOString().split("T")[0])
  }
  const dayIndex = new Map(days.map((d, i) => [d, i]))

  // --- perUser: dense daily arrays ------------------------------------------
  const byUser = new Map<
    string,
    { userId: string; name: string; image: string | null; daily: number[] }
  >()
  for (const row of perUserRaw) {
    const key = row.userId
    let entry = byUser.get(key)
    if (!entry) {
      entry = {
        userId: row.userId,
        name: row.name || "Unknown",
        image: row.image,
        daily: new Array(days.length).fill(0),
      }
      byUser.set(key, entry)
    }
    const idx = dayIndex.get(row.day.toISOString().split("T")[0])
    if (idx !== undefined) entry.daily[idx] += Number(row.value)
  }

  // --- poolSplit: one row per day with both pools ---------------------------
  const splitMap = new Map<string, { time: string; shared: number; user: number }>(
    days.map((d) => [d, { time: d, shared: 0, user: 0 }])
  )
  for (const row of poolSplitRaw) {
    const key = row.day.toISOString().split("T")[0]
    const entry = splitMap.get(key)
    if (!entry) continue
    if (row.pool === "shared") entry.shared += Number(row.value)
    else entry.user += Number(row.value)
  }

  // --- byKey: one row per day, one column per key ---------------------------
  const UNATTRIBUTED = "unattributed"
  const keyIds = new Set<string>()
  const keyMap = new Map<string, Record<string, number | string>>(
    days.map((d) => [d, { time: d }])
  )
  for (const row of byKeyRaw) {
    const key = row.day.toISOString().split("T")[0]
    const entry = keyMap.get(key)
    if (!entry) continue
    const id = row.keyId || UNATTRIBUTED
    keyIds.add(id)
    entry[id] = ((entry[id] as number) || 0) + Number(row.value)
  }
  // Fill gaps so recharts stacks render continuously rather than breaking.
  for (const entry of keyMap.values()) {
    for (const id of keyIds) {
      if (entry[id] === undefined) entry[id] = 0
    }
  }

  return NextResponse.json({
    range,
    provider,
    unit,
    currentLimits: {
      free: budget?.limit ?? null,
      pro: budget ? budget.limit * PRO_BUDGET_MULTIPLIER : null,
    },
    // Sent rather than imported client-side: usage-budgets lives under lib/server
    // and shouldn't be pulled into a client bundle just for one constant.
    proMultiplier: PRO_BUDGET_MULTIPLIER,
    days,
    perUser: [...byUser.values()],
    poolSplit: [...splitMap.values()],
    byKey: [...keyMap.values()],
    keyIds: [...keyIds].sort(),
  })
}
