/**
 * /api/chats/[chatId]/netlify/env — the Deployment tab of Environment Variables.
 *
 * GET → the env vars on the chat repo's Netlify site, or `site: null` when the
 *       repo isn't deployed (then the tab is hidden).
 * PUT → make the site's env vars match the body, then start a new deploy if
 *       anything changed so the site picks them up.
 */

import { NextRequest } from "next/server"
import { requireAuth, isAuthError, getChatWithAuth, notFound, badRequest, internalError } from "@/lib/db/api-helpers"
import { isRealRepo } from "@/lib/types"
import { readNetlifyToken } from "@/lib/server/netlify"
import { DeployError, findRepoSite, getSiteEnv, saveSiteEnv, startBuild } from "@/lib/server/netlify-deploy"

type Params = { params: Promise<{ chatId: string }> }

export async function GET(_req: NextRequest, { params }: Params): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth
  const { chatId } = await params
  const chat = await getChatWithAuth(chatId, auth.userId)
  if (!chat) return notFound("Chat not found")

  const token = await readNetlifyToken(auth.userId)
  if (!token || !isRealRepo(chat.repo)) return Response.json({ site: null })
  try {
    const site = await findRepoSite(token, chat.repo, chat.baseBranch)
    if (!site) return Response.json({ site: null })
    return Response.json({ site: { name: site.name }, environmentVariables: await getSiteEnv(token, site) })
  } catch (error) {
    // A revoked authorization shows up as 401; hide the tab like an unconnected account.
    if (error instanceof DeployError && error.status === 401) return Response.json({ site: null })
    return internalError(error)
  }
}

export async function PUT(req: NextRequest, { params }: Params): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth
  const { chatId } = await params
  const chat = await getChatWithAuth(chatId, auth.userId)
  if (!chat) return notFound("Chat not found")
  if (!isRealRepo(chat.repo)) return badRequest("Deploying needs a GitHub repository")

  const body = (await req.json().catch(() => ({}))) as { environmentVariables?: Record<string, string> }
  const token = await readNetlifyToken(auth.userId)
  if (!token) return badRequest("Connect Netlify first")
  try {
    const site = await findRepoSite(token, chat.repo, chat.baseBranch)
    if (!site) return badRequest("Deploy this repository to Netlify first")
    const changed = await saveSiteEnv(token, site, body.environmentVariables ?? {})
    if (changed) await startBuild(token, site.id)
    return Response.json({ redeployed: changed })
  } catch (error) {
    if (error instanceof DeployError) return Response.json({ error: error.message }, { status: 400 })
    return internalError(error)
  }
}
