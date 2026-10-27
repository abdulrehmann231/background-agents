/**
 * /api/chats/[chatId]/netlify/env — the Deployment tab of Environment Variables.
 *
 * The variables are stored in Backgrounder, like the repository ones, and sent
 * to the repo's Netlify site; they're never read back from Netlify.
 *
 * GET → the repo's deployment env vars, or `connected: false` (then the tab is
 *       hidden) when Netlify isn't connected.
 * PUT → save them. If the repo already has a site, the changes go to Netlify
 *       first and a new deploy starts; otherwise the first deploy sets them.
 */

import { NextRequest } from "next/server"
import { requireAuth, isAuthError, getChatWithAuth, notFound, badRequest, internalError } from "@/lib/db/api-helpers"
import { isRealRepo } from "@/lib/types"
import { readDeployEnv, readNetlifyToken, writeDeployEnv } from "@/lib/server/netlify"
import { DeployError, findRepoSite, setSiteEnv, startBuild } from "@/lib/server/netlify-deploy"

type Params = { params: Promise<{ chatId: string }> }

export async function GET(_req: NextRequest, { params }: Params): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth
  const { chatId } = await params
  const chat = await getChatWithAuth(chatId, auth.userId)
  if (!chat) return notFound("Chat not found")

  if (!isRealRepo(chat.repo) || !(await readNetlifyToken(auth.userId))) return Response.json({ connected: false })
  return Response.json({ connected: true, environmentVariables: await readDeployEnv(auth.userId, chat.repo) })
}

export async function PUT(req: NextRequest, { params }: Params): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth
  const { chatId } = await params
  const chat = await getChatWithAuth(chatId, auth.userId)
  if (!chat) return notFound("Chat not found")
  if (!isRealRepo(chat.repo)) return badRequest("Deploying needs a GitHub repository")

  const body = (await req.json().catch(() => ({}))) as { environmentVariables?: Record<string, unknown> }
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(body.environmentVariables ?? {})) {
    if (typeof value === "string" && key.trim()) env[key.trim()] = value
  }
  const token = await readNetlifyToken(auth.userId)
  if (!token) return badRequest("Connect Netlify first")

  try {
    const previous = await readDeployEnv(auth.userId, chat.repo)
    const changed = Object.keys(env).filter((key) => previous[key] !== env[key])
    const removed = Object.keys(previous).filter((key) => !(key in env))
    if (changed.length + removed.length === 0) return Response.json({ redeployed: false })

    const site = await findRepoSite(token, chat.repo, chat.baseBranch)
    if (site) {
      await setSiteEnv(token, site, Object.fromEntries(changed.map((key) => [key, env[key]])), removed)
      await startBuild(token, site.id)
    }
    await writeDeployEnv(auth.userId, chat.repo, env)
    return Response.json({ redeployed: !!site })
  } catch (error) {
    if (error instanceof DeployError) return Response.json({ error: error.message }, { status: 400 })
    return internalError(error)
  }
}
