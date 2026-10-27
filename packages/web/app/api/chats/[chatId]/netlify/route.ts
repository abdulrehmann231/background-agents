/**
 * /api/chats/[chatId]/netlify
 *
 * GET  → what the Deploy to Netlify dialog shows: whether Netlify is
 *        connected, the repo's site and its latest deploy, and whether this
 *        chat has commits that aren't on the base branch yet.
 * POST → deploy. The first deploy creates the repo's site with its deployment
 *        env vars (Netlify then builds it); later ones start a new build.
 */

import { NextRequest } from "next/server"
import { compareBranches, isGitHubApiError } from "@background-agents/common"
import {
  requireAuth,
  isAuthError,
  getChatWithAuth,
  getGitHubToken,
  notFound,
  badRequest,
  internalError,
} from "@/lib/db/api-helpers"
import { isRealRepo } from "@/lib/types"
import { readDeployEnv, readNetlifyToken } from "@/lib/server/netlify"
import {
  DeployError,
  createRepoSite,
  findRepoSite,
  latestDeploy,
  startBuild,
  toSiteName,
} from "@/lib/server/netlify-deploy"

type Params = { params: Promise<{ chatId: string }> }

export async function GET(_req: NextRequest, { params }: Params): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth
  const { chatId } = await params
  const chat = await getChatWithAuth(chatId, auth.userId)
  if (!chat) return notFound("Chat not found")
  if (!isRealRepo(chat.repo)) return badRequest("Deploying needs a GitHub repository")

  const [owner, repoName] = chat.repo.split("/")
  let unmerged = false
  const githubToken = await getGitHubToken(auth.userId)
  if (githubToken && chat.branch) {
    try {
      unmerged = (await compareBranches(githubToken, owner, repoName, chat.baseBranch, chat.branch)).ahead_by > 0
    } catch (error) {
      // The chat's branch may not be pushed yet; then there's nothing to merge.
      if (!(isGitHubApiError(error) && error.status === 404)) console.warn("[netlify] branch compare failed:", error)
    }
  }
  const info = {
    branch: chat.baseBranch,
    suggestedName: toSiteName(repoName),
    unmerged,
  }

  const token = await readNetlifyToken(auth.userId)
  if (!token) return Response.json({ ...info, connected: false })
  try {
    const site = await findRepoSite(token, chat.repo, chat.baseBranch)
    const deploy = site ? await latestDeploy(token, site.id) : null
    return Response.json({
      ...info,
      connected: true,
      site: site && { name: site.name, url: site.ssl_url, adminUrl: site.admin_url },
      deploy: deploy && { state: deploy.state, error: deploy.error_message ?? null },
    })
  } catch (error) {
    // A revoked authorization shows up as 401; offer Connect again.
    if (error instanceof DeployError && error.status === 401) return Response.json({ ...info, connected: false })
    return internalError(error)
  }
}

export async function POST(req: NextRequest, { params }: Params): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth
  const { chatId } = await params
  const chat = await getChatWithAuth(chatId, auth.userId)
  if (!chat) return notFound("Chat not found")
  if (!isRealRepo(chat.repo)) return badRequest("Deploying needs a GitHub repository")

  const body = (await req.json().catch(() => ({}))) as { name?: string }
  const token = await readNetlifyToken(auth.userId)
  if (!token) return badRequest("Connect Netlify first")
  const githubToken = await getGitHubToken(auth.userId)
  if (!githubToken) return badRequest("Sign in with GitHub again to deploy")

  try {
    const site = await findRepoSite(token, chat.repo, chat.baseBranch)
    if (site) {
      await startBuild(token, site.id)
    } else {
      const name = toSiteName(body.name ?? "")
      if (!name) return badRequest("Enter a site name")
      const env = await readDeployEnv(auth.userId, chat.repo)
      await createRepoSite({ token, githubToken, repo: chat.repo, branch: chat.baseBranch, name, env })
    }
    return Response.json({ ok: true })
  } catch (error) {
    if (error instanceof DeployError) {
      // Netlify answers 422 "subdomain must be unique" for a name that's in use.
      const message = error.status === 422 && error.message.includes("subdomain")
        ? "That site name is taken. Try another one."
        : error.message
      return Response.json({ error: message }, { status: 400 })
    }
    if (isGitHubApiError(error)) return Response.json({ error: `GitHub: ${error.message}` }, { status: 400 })
    return internalError(error)
  }
}
