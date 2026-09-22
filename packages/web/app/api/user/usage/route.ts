import { NextRequest } from "next/server"
import { requireAuth, isAuthError, internalError } from "@/lib/db/api-helpers"
import {
  getUserUsageSummary,
  parseUsageRange,
  type UserUsageSummary,
} from "@/lib/db/user-usage"

export type UserUsageResponse = UserUsageSummary

/**
 * GET /api/user/usage?range=7d|30d|90d — the authenticated user's own spend and
 * token usage over a window, for the Usage settings tab.
 *
 * The self-serve counterpart to /api/admin/stats: same shape of question, but
 * scoped to the caller and gated on requireAuth rather than requireAdmin.
 *
 * Every figure is aggregated in Postgres. A talkative account accumulates a
 * TokenUsage row per turn, so this must never grow into "fetch the rows and sum
 * them in the route".
 */
export async function GET(req: NextRequest): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth
  const { userId } = auth

  const range = parseUsageRange(req.nextUrl.searchParams.get("range"), "30d")

  try {
    const summary = await getUserUsageSummary(userId, range)
    return Response.json(summary satisfies UserUsageResponse)
  } catch (error) {
    return internalError(error)
  }
}
