/**
 * DELETE /api/netlify/sites/[siteId] → delete one of the user's Netlify sites
 * (Settings → Deployments). The repo's read-only deploy key and webhook stay
 * on GitHub.
 */

import { NextRequest } from "next/server"
import { requireAuth, isAuthError, badRequest, internalError } from "@/lib/db/api-helpers"
import { readNetlifyToken } from "@/lib/server/netlify"
import { DeployError, deleteSite } from "@/lib/server/netlify-deploy"

type Params = { params: Promise<{ siteId: string }> }

export async function DELETE(_req: NextRequest, { params }: Params): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth
  const { siteId } = await params

  const token = await readNetlifyToken(auth.userId)
  if (!token) return badRequest("Connect Netlify first")
  try {
    await deleteSite(token, siteId)
    return Response.json({ ok: true })
  } catch (error) {
    if (error instanceof DeployError) return Response.json({ error: error.message }, { status: 400 })
    return internalError(error)
  }
}
