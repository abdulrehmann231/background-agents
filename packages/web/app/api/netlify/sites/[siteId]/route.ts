/**
 * DELETE /api/netlify/sites/[siteId] → delete one of the user's Netlify sites
 * (Settings → Deployments), then remove its deploy key and Netlify's webhook
 * from the GitHub repo.
 */

import { NextRequest } from "next/server"
import { requireAuth, isAuthError, badRequest, getGitHubToken, internalError } from "@/lib/db/api-helpers"
import { readNetlifyToken } from "@/lib/server/netlify"
import { DeployError, deleteSite, getSite, listRepoSites, unlinkRepo } from "@/lib/server/netlify-deploy"

type Params = { params: Promise<{ siteId: string }> }

export async function DELETE(_req: NextRequest, { params }: Params): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth
  const { siteId } = await params

  const token = await readNetlifyToken(auth.userId)
  if (!token) return badRequest("Connect Netlify first")
  try {
    const site = await getSite(token, siteId)
    await deleteSite(token, siteId)

    const repo = site.build_settings?.repo_path
    const githubToken = repo ? await getGitHubToken(auth.userId) : null
    if (repo && githubToken) {
      try {
        // Netlify's webhook serves every site linked to the repo.
        const repoStillDeployed = (await listRepoSites(token)).some((s) => s.build_settings?.repo_path === repo)
        await unlinkRepo(githubToken, repo, site.name, repoStillDeployed)
      } catch (error) {
        // The site is already gone; a leftover key or webhook only clutters the repo.
        console.warn(`[netlify] couldn't remove ${repo}'s deploy key or webhook:`, error)
      }
    }
    return Response.json({ ok: true })
  } catch (error) {
    if (error instanceof DeployError) return Response.json({ error: error.message }, { status: 400 })
    return internalError(error)
  }
}
