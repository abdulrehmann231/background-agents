/**
 * GET /api/netlify/sites → the user's Netlify sites that are linked to a
 * GitHub repo. The chat header uses it to show whether a repo is deployed,
 * and Settings → Deployments lists them.
 */

import { requireAuth, isAuthError, internalError } from "@/lib/db/api-helpers"
import { readNetlifyToken } from "@/lib/server/netlify"
import { DeployError, listRepoSites } from "@/lib/server/netlify-deploy"

export async function GET(): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth

  const token = await readNetlifyToken(auth.userId)
  if (!token) return Response.json({ connected: false, sites: [] })
  try {
    const sites = await listRepoSites(token)
    return Response.json({
      connected: true,
      sites: sites.map((s) => ({
        id: s.id,
        name: s.name,
        url: s.ssl_url,
        adminUrl: s.admin_url,
        repo: s.build_settings?.repo_path,
        branch: s.build_settings?.repo_branch,
      })),
    })
  } catch (error) {
    // A revoked authorization shows up as 401; treat it as not connected.
    if (error instanceof DeployError && error.status === 401) return Response.json({ connected: false, sites: [] })
    return internalError(error)
  }
}
