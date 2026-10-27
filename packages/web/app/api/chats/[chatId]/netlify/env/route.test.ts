import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const m = vi.hoisted(() => ({
  readDeployEnv: vi.fn(),
  writeDeployEnv: vi.fn(),
  findRepoSite: vi.fn(),
  setSiteEnv: vi.fn(),
  startBuild: vi.fn(),
}))

vi.mock("@/lib/server/netlify", () => ({
  readNetlifyToken: vi.fn().mockResolvedValue("nf"),
  readDeployEnv: m.readDeployEnv,
  writeDeployEnv: m.writeDeployEnv,
}))
vi.mock("@/lib/server/netlify-deploy", () => ({
  DeployError: class extends Error {},
  findRepoSite: m.findRepoSite,
  setSiteEnv: m.setSiteEnv,
  startBuild: m.startBuild,
}))
vi.mock("@/lib/db/api-helpers", () => ({
  requireAuth: vi.fn().mockResolvedValue({ userId: "user1" }),
  isAuthError: (r: unknown) => r instanceof Response,
  getChatWithAuth: vi.fn().mockResolvedValue({ repo: "owner/my-app", baseBranch: "main" }),
  notFound: (message: string) => Response.json({ error: message }, { status: 404 }),
  badRequest: (message: string) => Response.json({ error: message }, { status: 400 }),
  internalError: () => Response.json({ error: "internal" }, { status: 500 }),
}))

import { PUT } from "./route"

const site = { id: "site1", name: "my-app" }
const save = (environmentVariables: Record<string, string>) =>
  PUT(
    new NextRequest("http://localhost/api/chats/chat1/netlify/env", { method: "PUT", body: JSON.stringify({ environmentVariables }) }),
    { params: Promise.resolve({ chatId: "chat1" }) }
  )

beforeEach(() => {
  vi.clearAllMocks()
  m.readDeployEnv.mockResolvedValue({ API_URL: "old", OLD_KEY: "x", SAME: "1" })
})

describe("PUT /api/chats/[chatId]/netlify/env", () => {
  it("sends the changes to a deployed site, redeploys it, then stores the variables", async () => {
    m.findRepoSite.mockResolvedValue(site)

    const res = await save({ API_URL: "new", SAME: "1", NEW_KEY: "y" })

    expect(await res.json()).toEqual({ redeployed: true })
    expect(m.setSiteEnv).toHaveBeenCalledWith("nf", site, { API_URL: "new", NEW_KEY: "y" }, ["OLD_KEY"])
    expect(m.startBuild).toHaveBeenCalledWith("nf", "site1")
    expect(m.writeDeployEnv).toHaveBeenCalledWith("user1", "owner/my-app", { API_URL: "new", SAME: "1", NEW_KEY: "y" })
  })

  it("only stores the variables before the first deploy", async () => {
    m.findRepoSite.mockResolvedValue(null)

    const res = await save({ API_URL: "new" })

    expect(await res.json()).toEqual({ redeployed: false })
    expect(m.setSiteEnv).not.toHaveBeenCalled()
    expect(m.writeDeployEnv).toHaveBeenCalledWith("user1", "owner/my-app", { API_URL: "new" })
  })

  it("does nothing when the variables didn't change", async () => {
    const res = await save({ API_URL: "old", OLD_KEY: "x", SAME: "1" })

    expect(await res.json()).toEqual({ redeployed: false })
    expect(m.findRepoSite).not.toHaveBeenCalled()
    expect(m.writeDeployEnv).not.toHaveBeenCalled()
  })
})
