import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import { requireAdmin, isAuthError } from "@/lib/db/api-helpers"
import { getRangeInterval, parseTimeRange } from "@/lib/db/time-range"
import { MICRO_PER_USD } from "@/lib/server/credits"

/**
 * GET /api/admin/topups
 *
 * Top-up payments (Stripe purchases credited via CreditTransaction) grouped by
 * user, for the "Top-ups by user" chart on the admin Leaderboard.
 *
 * Scoped to `type = 'purchase'` only — refunds, chargebacks, grants, and usage
 * debits all live in the same ledger, but this answers "who is paying us,"
 * not "whose balance moved."
 *
 * Query params:
 *   - range: "24h" | "7d" | "30d" | "all" (default "30d")
 *   - excludeAdmins: "false" to include admin accounts (default: exclude)
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin()
  if (isAuthError(auth)) return auth

  const { searchParams } = new URL(request.url)
  const range = parseTimeRange(searchParams.get("range"), "30d")
  const excludeAdmins = searchParams.get("excludeAdmins") !== "false"
  // "all" contributes no time clause; every other range binds the interval as
  // a parameter (not interpolated) so it can never carry injected SQL.
  const rangeWhere =
    range === "all"
      ? Prisma.empty
      : Prisma.sql`AND ct."createdAt" >= NOW() - ${getRangeInterval(range)}::interval`
  const adminWhere = Prisma.sql`AND (${excludeAdmins} = false OR u."isAdmin" = false)`

  const topPromise = prisma.$queryRaw<
    Array<{ userId: string; name: string | null; image: string | null; totalMicroUsd: number; count: bigint }>
  >`
    SELECT
      u.id as "userId",
      u.name,
      u.image,
      SUM(ct."amountMicroUsd")::float as "totalMicroUsd",
      COUNT(ct.id)::bigint as count
    FROM "CreditTransaction" ct
    JOIN "User" u ON u.id = ct."userId"
    WHERE ct.type = 'purchase'
      ${rangeWhere}
      ${adminWhere}
    GROUP BY u.id, u.name, u.image
    ORDER BY "totalMicroUsd" DESC
    LIMIT 10
  `

  const totalPromise = prisma.$queryRaw<Array<{ totalMicroUsd: number | null; count: bigint }>>`
    SELECT SUM(ct."amountMicroUsd")::float as "totalMicroUsd", COUNT(ct.id)::bigint as count
    FROM "CreditTransaction" ct
    JOIN "User" u ON u.id = ct."userId"
    WHERE ct.type = 'purchase'
      ${rangeWhere}
      ${adminWhere}
  `

  const [top, totalRows] = await Promise.all([topPromise, totalPromise])

  const users = top.map((r) => ({
    userId: r.userId,
    name: r.name || "Unknown",
    image: r.image,
    totalUsd: r.totalMicroUsd / MICRO_PER_USD,
    count: Number(r.count),
  }))

  const totalRow = totalRows[0]

  return NextResponse.json({
    range,
    totalUsd: (totalRow?.totalMicroUsd ?? 0) / MICRO_PER_USD,
    totalCount: Number(totalRow?.count ?? 0),
    users,
  })
}
