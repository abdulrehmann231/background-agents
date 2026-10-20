import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { createTestUser, databaseDescribe, deleteTestUser } from "@/lib/server/db-test-helpers"

// The real database is used; auth and the sandbox install are stubbed.
const mocks = vi.hoisted(() => ({ userId: "", install: vi.fn() }))
vi.mock("@/lib/db/api-helpers", async (original) => ({
  ...await original<typeof import("@/lib/db/api-helpers")>(),
  requireAuth: async () => ({ userId: mocks.userId }),
}))
vi.mock("@daytonaio/sdk", () => ({ Daytona: class { async get() { return {} } } }))
vi.mock("@/lib/sandbox", () => ({ ensureSandboxStarted: async () => {} }))
vi.mock("@background-agents/sandbox-skills/sandbox", async (original) => ({
  ...await original<typeof import("@background-agents/sandbox-skills/sandbox")>(),
  installSkillArchive: mocks.install,
}))

type Database = typeof import("@/lib/db/prisma").prisma
let prisma: Database
let POST: typeof import("./route").POST
let GET: typeof import("../route").GET

function upload(chatId: string, file: File) {
  const form = new FormData()
  form.append("chatId", chatId)
  form.append("file", file)
  return POST(new NextRequest("http://localhost/api/skills/upload", { method: "POST", body: form }))
}

databaseDescribe("skill zip upload", () => {
  beforeAll(async () => {
    process.env.DAYTONA_API_KEY ??= "test"
    ;({ prisma, userId: mocks.userId } = await createTestUser("skill-upload"))
    ;({ POST } = await import("./route"))
    ;({ GET } = await import("../route"))
  })
  afterAll(() => deleteTestUser(prisma, mocks.userId))
  beforeEach(() => mocks.install.mockReset())

  it("saves an uploaded skill for the repo, and uploading it again replaces it", async () => {
    const chat = await prisma.chat.create({ data: { userId: mocks.userId, repo: "owner/skills-repo", status: "ready", sandboxId: "sandbox-1" } })
    mocks.install.mockResolvedValue({ fullHandle: "upload/my-skill", success: true })

    expect((await upload(chat.id, new File([new Uint8Array([1, 2, 3])], "my-skill.zip"))).status).toBe(201)
    expect((await upload(chat.id, new File([new Uint8Array([4, 5])], "my-skill.zip"))).status).toBe(201)

    const saved = await prisma.skill.findMany({ where: { userId: mocks.userId, repo: "owner/skills-repo" } })
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ publisher: "upload", name: "my-skill", fullHandle: "upload/my-skill" })
    expect([...saved[0].archive!]).toEqual([4, 5])

    // The list for the panel doesn't send the zip back.
    const listed = await (await GET(new NextRequest("http://localhost/api/skills?repo=owner/skills-repo"))).json()
    expect(listed.skills).toHaveLength(1)
    expect(listed.skills[0]).not.toHaveProperty("archive")
  })

  it("does not save a zip that fails to install", async () => {
    const chat = await prisma.chat.create({ data: { userId: mocks.userId, repo: "owner/failed-repo", status: "ready", sandboxId: "sandbox-2" } })
    mocks.install.mockResolvedValue({ fullHandle: "upload", success: false, error: "The zip must contain exactly one SKILL.md" })

    const response = await upload(chat.id, new File([new Uint8Array([1])], "broken.zip"))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "The zip must contain exactly one SKILL.md" })
    expect(await prisma.skill.count({ where: { userId: mocks.userId, repo: "owner/failed-repo" } })).toBe(0)
  })
})
