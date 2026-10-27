import { describe, it, expect, vi, beforeEach } from "vitest"
import { createRepoSite, setSiteEnv, toSiteName, unlinkRepo, DeployError, type NetlifySite } from "./netlify-deploy"

type Call = { method: string; url: string; body?: unknown }
let calls: Call[] = []
let routes: Record<string, (body?: unknown) => Response> = {}

beforeEach(() => {
  calls = []
  routes = {}
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET"
    const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined
    calls.push({ method, url, body })
    const route = Object.keys(routes).find((key) => `${method} ${url}`.startsWith(key))
    if (!route) throw new Error(`unexpected ${method} ${url}`)
    return routes[route](body)
  }))
})

const json = (data: unknown, status = 200) => Response.json(data, { status })
const site: NetlifySite = { id: "site1", name: "my-app", ssl_url: "https://my-app.netlify.app", admin_url: "https://app.netlify.com/projects/my-app", account_id: "acct1" }

function githubRepo(admin: boolean, pkg: Record<string, unknown> | null) {
  routes["GET https://api.github.com/repos/owner/my-app/contents/package.json"] = () =>
    pkg ? json(pkg) : json({ message: "Not Found" }, 404)
  routes["GET https://api.github.com/repos/owner/my-app"] = () =>
    json({ id: 42, name: "my-app", full_name: "owner/my-app", private: true, permissions: { admin } })
}

const opts = { token: "nf", githubToken: "gh", repo: "owner/my-app", branch: "main", name: "my-app", env: {} }

describe("createRepoSite", () => {
  it("links a new site to the repo's branch with the detected Next.js build and makes it public", async () => {
    githubRepo(true, { dependencies: { next: "15.5.28" } })
    routes["POST https://api.netlify.com/api/v1/sites"] = () => json(site)
    routes["POST https://api.netlify.com/api/v1/deploy_keys"] = () => json({ id: "key1", public_key: "ssh-ed25519 AAA" })
    routes["POST https://api.github.com/repos/owner/my-app/keys"] = () => json({ id: 7 }, 201)
    routes["PATCH https://api.netlify.com/api/v1/sites/site1"] = () => json({ ...site, deploy_hook: "https://api.netlify.com/hooks/github" })
    // The repo already has Netlify's webhook from another site.
    routes["POST https://api.github.com/repos/owner/my-app/hooks"] = () => json({ message: "Hook already exists" }, 422)

    await createRepoSite(opts)

    const link = calls.find((c) => c.method === "PATCH")?.body as { repo: Record<string, unknown>; plugins: unknown; sso_login: unknown }
    expect(link.repo).toMatchObject({ repo_path: "owner/my-app", repo_branch: "main", deploy_key_id: "key1", cmd: "npm run build", dir: ".next" })
    expect(link.plugins).toEqual([{ package: "@netlify/plugin-nextjs" }])
    expect(link.sso_login).toBe(false)
    expect(calls.find((c) => c.url.endsWith("/keys"))?.body).toMatchObject({ key: "ssh-ed25519 AAA", read_only: true })
  })

  it("stops before creating a site when the user isn't an admin of the repo", async () => {
    githubRepo(false, null)

    await expect(createRepoSite(opts)).rejects.toBeInstanceOf(DeployError)
    expect(calls.some((c) => c.url.includes("api.netlify.com"))).toBe(false)
  })

  it("removes the half-created site when GitHub refuses the deploy key", async () => {
    githubRepo(true, null)
    routes["POST https://api.netlify.com/api/v1/sites"] = () => json(site)
    routes["POST https://api.netlify.com/api/v1/deploy_keys"] = () => json({ id: "key1", public_key: "ssh-ed25519 AAA" })
    routes["POST https://api.github.com/repos/owner/my-app/keys"] = () => json({ message: "Resource not accessible" }, 403)
    routes["DELETE https://api.netlify.com/api/v1/sites/site1"] = () => new Response(null, { status: 204 })

    await expect(createRepoSite(opts)).rejects.toMatchObject({ status: 403 })
    expect(calls.at(-1)).toMatchObject({ method: "DELETE", url: "https://api.netlify.com/api/v1/sites/site1" })
  })
})

describe("setSiteEnv", () => {
  const env = "https://api.netlify.com/api/v1/accounts/acct1/env"
  const all = (value: string) => [{ context: "all", value }]

  it("adds new variables, replaces existing ones and deletes removed ones", async () => {
    routes[`GET ${env}?site_id=site1`] = () => json([{ key: "API_URL" }, { key: "SET_IN_NETLIFY" }])
    routes[`POST ${env}?site_id=site1`] = () => json([], 201)
    routes[`PUT ${env}/API_URL?site_id=site1`] = () => json({})
    routes[`DELETE ${env}/OLD_KEY?site_id=site1`] = () => new Response(null, { status: 204 })
    // Already deleted in Netlify's dashboard.
    routes[`DELETE ${env}/GONE?site_id=site1`] = () => json({ message: "Not Found" }, 404)

    await setSiteEnv("nf", site, { API_URL: "https://api.example.com", NEW_KEY: "y" }, ["OLD_KEY", "GONE"])

    expect(calls.filter((c) => c.method !== "GET")).toEqual([
      { method: "POST", url: `${env}?site_id=site1`, body: [{ key: "NEW_KEY", values: all("y") }] },
      { method: "PUT", url: `${env}/API_URL?site_id=site1`, body: { key: "API_URL", values: all("https://api.example.com") } },
      { method: "DELETE", url: `${env}/OLD_KEY?site_id=site1`, body: undefined },
      { method: "DELETE", url: `${env}/GONE?site_id=site1`, body: undefined },
    ])
  })
})

describe("unlinkRepo", () => {
  beforeEach(() => {
    routes["GET https://api.github.com/repos/owner/my-app/keys"] = () =>
      json([{ id: 1, title: "Netlify (my-app)" }, { id: 2, title: "Netlify (other-site)" }, { id: 3, title: "laptop" }])
    routes["GET https://api.github.com/repos/owner/my-app/hooks"] = () =>
      json([{ id: 10, config: { url: "https://api.netlify.com/hooks/github" } }, { id: 11, config: { url: "https://ci.example.com" } }])
    routes["DELETE https://api.github.com/repos/owner/my-app/"] = () => new Response(null, { status: 204 })
  })
  const deleted = () => calls.filter((c) => c.method === "DELETE").map((c) => c.url.replace("https://api.github.com/repos/owner/my-app/", ""))

  it("removes the site's deploy key and Netlify's webhook", async () => {
    await unlinkRepo("gh", "owner/my-app", "my-app", false)
    expect(deleted()).toEqual(["keys/1", "hooks/10"])
  })

  it("keeps the webhook while another site deploys from the repo", async () => {
    await unlinkRepo("gh", "owner/my-app", "my-app", true)
    expect(deleted()).toEqual(["keys/1"])
  })
})

describe("toSiteName", () => {
  it("turns a repo name into a valid netlify.app subdomain", () => {
    expect(toSiteName("My_Cool App!")).toBe("my-cool-app")
  })
})
