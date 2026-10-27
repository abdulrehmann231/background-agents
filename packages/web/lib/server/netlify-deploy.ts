/**
 * Deploy a repo to the user's Netlify account: one Netlify site per repo,
 * linked to its base branch, so Netlify rebuilds it on every push or /merge.
 * The repo is linked the way `netlify init` does it: a read-only deploy key
 * and a webhook added with the user's GitHub token.
 */
import "server-only"
import { getRepo, githubFetch, isGitHubApiError } from "@background-agents/common"

const NETLIFY_API = "https://api.netlify.com/api/v1"

export interface NetlifySite {
  id: string
  name: string
  ssl_url: string
  admin_url: string
  account_id: string
  build_settings?: { repo_path?: string; repo_branch?: string }
}

export interface NetlifyDeploy {
  state: string
  error_message?: string | null
}

/** A failed deploy step, with a message the dialog shows as-is. */
export class DeployError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

async function netlify<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${NETLIFY_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  })
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { message?: string; errors?: Record<string, string[]> }
    const fieldErrors = Object.entries(data.errors ?? {}).map(([field, msgs]) => `${field} ${msgs.join(", ")}`)
    throw new DeployError(data.message || fieldErrors.join("; ") || `Netlify API error: ${res.status}`, res.status)
  }
  return (res.status === 204 ? undefined : await res.json()) as T
}

/** Site names become `<name>.netlify.app`, so keep lowercase letters, digits and hyphens. */
export function toSiteName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 63)
}

/** The account's sites that are linked to a GitHub repo (the first 100 sites). */
export async function listRepoSites(token: string): Promise<NetlifySite[]> {
  const sites = await netlify<NetlifySite[]>(token, "/sites?filter=all&per_page=100")
  return sites.filter((s) => s.build_settings?.repo_path)
}

/** The site linked to this repo and branch, if it was deployed before. */
export async function findRepoSite(token: string, repo: string, branch: string): Promise<NetlifySite | null> {
  const sites = await listRepoSites(token)
  return sites.find((s) => s.build_settings?.repo_path === repo && s.build_settings?.repo_branch === branch) ?? null
}

export async function latestDeploy(token: string, siteId: string): Promise<NetlifyDeploy | null> {
  const [deploy] = await netlify<NetlifyDeploy[]>(token, `/sites/${siteId}/deploys?per_page=1`)
  return deploy ?? null
}

export async function getSite(token: string, siteId: string): Promise<NetlifySite> {
  return netlify<NetlifySite>(token, `/sites/${siteId}`)
}

export async function deleteSite(token: string, siteId: string): Promise<void> {
  await netlify(token, `/sites/${siteId}`, { method: "DELETE" })
}

export async function startBuild(token: string, siteId: string): Promise<void> {
  await netlify(token, `/sites/${siteId}/builds`, { method: "POST" })
}

/**
 * Set `env` on the site for every deploy context and delete the `removed`
 * keys. Other variables on the site are left as they are.
 */
export async function setSiteEnv(
  token: string,
  site: NetlifySite,
  env: Record<string, string>,
  removed: string[] = []
): Promise<void> {
  const base = `/accounts/${site.account_id}/env`
  const query = `?site_id=${site.id}`
  const keys = Object.keys(env)
  if (keys.length > 0) {
    const existing = new Set((await netlify<{ key: string }[]>(token, `${base}${query}`)).map((v) => v.key))
    const added = keys.filter((key) => !existing.has(key))
    if (added.length > 0) {
      await netlify(token, `${base}${query}`, {
        method: "POST",
        body: JSON.stringify(added.map((key) => ({ key, values: [{ context: "all", value: env[key] }] }))),
      })
    }
    // PUT replaces the variable's values; PATCH can't set the "all" context.
    for (const key of keys.filter((k) => existing.has(k))) {
      await netlify(token, `${base}/${encodeURIComponent(key)}${query}`, {
        method: "PUT",
        body: JSON.stringify({ key, values: [{ context: "all", value: env[key] }] }),
      })
    }
  }
  for (const key of removed) {
    await netlify(token, `${base}/${encodeURIComponent(key)}${query}`, { method: "DELETE" }).catch((error) => {
      // Already gone from the site, e.g. removed in Netlify's dashboard.
      if (!(error instanceof DeployError && error.status === 404)) throw error
    })
  }
}

/**
 * Build settings from the repo's package.json. Netlify detects the framework
 * but doesn't run a build for API-linked sites without these, and Next.js
 * needs its plugin to serve server routes. A netlify.toml in the repo still
 * takes precedence.
 */
async function buildSettings(githubToken: string, repo: string, branch: string) {
  let pkg: { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
  try {
    pkg = await githubFetch(`/repos/${repo}/contents/package.json?ref=${encodeURIComponent(branch)}`, githubToken, {
      accept: "application/vnd.github.raw+json",
    })
  } catch (error) {
    // No package.json: a plain static site, published as-is.
    if (isGitHubApiError(error) && error.status === 404) return { cmd: "", dir: "", plugins: [] }
    throw error
  }
  if (pkg.dependencies?.next || pkg.devDependencies?.next) {
    return { cmd: "npm run build", dir: ".next", plugins: ["@netlify/plugin-nextjs"] }
  }
  if (pkg.scripts?.build) return { cmd: "npm run build", dir: "dist", plugins: [] }
  return { cmd: "", dir: "", plugins: [] }
}

/**
 * One webhook per repo serves every Netlify site linked to it. Only pushes:
 * the site deploys its base branch, and PR events would add Deploy Previews
 * that the dialog would report as the site's status.
 */
async function addWebhook(githubToken: string, repo: string, url: string): Promise<void> {
  try {
    await githubFetch(`/repos/${repo}/hooks`, githubToken, {
      method: "POST",
      body: JSON.stringify({ name: "web", config: { url, content_type: "json" }, events: ["push"], active: true }),
    })
  } catch (error) {
    // GitHub answers 422 when the repo already has this hook.
    if (!(isGitHubApiError(error) && error.status === 422)) throw error
  }
}

/** githubFetch parses a JSON body, and GitHub answers a DELETE with 204 and none. */
async function githubDelete(githubToken: string, path: string): Promise<void> {
  const res = await fetch(`https://api.github.com${path}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${githubToken}`, Accept: "application/vnd.github.v3+json" },
  })
  if (!res.ok && res.status !== 404) throw new Error(`GitHub API error: ${res.status}`)
}

/**
 * Remove what createRepoSite added to the repo: the site's deploy key, and
 * Netlify's webhook unless another site still deploys from the repo.
 */
export async function unlinkRepo(githubToken: string, repo: string, siteName: string, keepWebhook: boolean): Promise<void> {
  const keys = await githubFetch<{ id: number; title: string }[]>(`/repos/${repo}/keys`, githubToken)
  for (const key of keys.filter((k) => k.title === `Netlify (${siteName})`)) {
    await githubDelete(githubToken, `/repos/${repo}/keys/${key.id}`)
  }
  if (keepWebhook) return
  const hooks = await githubFetch<{ id: number; config: { url?: string } }[]>(`/repos/${repo}/hooks`, githubToken)
  for (const hook of hooks.filter((h) => h.config.url?.startsWith("https://api.netlify.com/hooks/github"))) {
    await githubDelete(githubToken, `/repos/${repo}/hooks/${hook.id}`)
  }
}

/**
 * Create a site linked to the repo's branch. Netlify starts the first build
 * by itself once the repo is linked, so env vars are set before that.
 */
export async function createRepoSite(opts: {
  token: string
  githubToken: string
  repo: string
  branch: string
  name: string
  env: Record<string, string>
}): Promise<NetlifySite> {
  const { token, githubToken, repo, branch, name, env } = opts
  const [owner, repoName] = repo.split("/")
  const ghRepo = await getRepo(githubToken, owner, repoName)
  if (!ghRepo.permissions?.admin) {
    throw new DeployError(`Deploying needs admin access to ${repo}, to add Netlify's deploy key.`, 403)
  }
  const build = await buildSettings(githubToken, repo, branch)

  const site = await netlify<NetlifySite>(token, "/sites", { method: "POST", body: JSON.stringify({ name }) })
  try {
    await setSiteEnv(token, site, env)
    const key = await netlify<{ id: string; public_key: string }>(token, "/deploy_keys", { method: "POST" })
    await githubFetch(`/repos/${repo}/keys`, githubToken, {
      method: "POST",
      body: JSON.stringify({ title: `Netlify (${site.name})`, key: key.public_key, read_only: true }),
    })
    const linked = await netlify<NetlifySite & { deploy_hook: string }>(token, `/sites/${site.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        repo: {
          id: ghRepo.id,
          provider: "github",
          repo_path: repo,
          repo_branch: branch,
          allowed_branches: [branch],
          deploy_key_id: key.id,
          private: ghRepo.private,
          cmd: build.cmd,
          dir: build.dir,
        },
        plugins: build.plugins.map((p) => ({ package: p })),
        // New sites are only visible to the Netlify team by default. This
        // makes them public; the field isn't in Netlify's API docs.
        sso_login: false,
      }),
    })
    await addWebhook(githubToken, repo, linked.deploy_hook)
    return linked
  } catch (error) {
    // Remove the half-set-up site so retrying doesn't hit "name taken".
    await deleteSite(token, site.id).catch((cleanupError) =>
      console.warn(`[netlify] couldn't remove half-created site ${site.name}:`, cleanupError)
    )
    throw error
  }
}
