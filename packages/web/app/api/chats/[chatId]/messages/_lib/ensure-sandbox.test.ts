/**
 * Tests for ensureSandboxForChat.
 *
 * Focus: a chat must always end up with a usable, started sandbox whenever one
 * can be created, and any path that produces a *fresh* sandbox must drop the
 * stale agent session pointer (agent-agnostically). A fresh sandbox is an empty
 * clone with no on-disk conversation history, so resuming an old `sessionId`
 * makes the agent CLI fail with "No conversation found with session ID".
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

// ── Mocks ────────────────────────────────────────────────────────────────────
const chatUpdate = vi.fn()
vi.mock("@/lib/db/prisma", () => ({
  prisma: { chat: { update: (args: unknown) => chatUpdate(args) } },
}))

const createSandboxForChat = vi.fn()
const ensureSandboxStarted = vi.fn()
const installSkillsForRepo = vi.fn()
vi.mock("@/lib/sandbox", () => ({
  createSandboxForChat: (args: unknown) => createSandboxForChat(args),
  ensureSandboxStarted: (s: unknown) => ensureSandboxStarted(s),
  installSkillsForRepo: (s: unknown, u: unknown, r: unknown) =>
    installSkillsForRepo(s, u, r),
}))

import { ensureSandboxForChat, type SandboxState } from "./ensure-sandbox"

const freshSandbox = { id: "sbx-new", state: "started" }

type ChatOverrides = {
  sessionId?: string | null
  sandboxId?: string | null
  branch?: string | null
  repo?: string
}

function setup(overrides: ChatOverrides = {}) {
  const chat = {
    id: "chat-1",
    repo: overrides.repo ?? "octocat/hello",
    baseBranch: "main",
    branch: overrides.branch ?? null,
    sandboxId: overrides.sandboxId ?? null,
    previewUrlPattern: null,
    sessionId: overrides.sessionId ?? null,
  }
  const state: SandboxState = {
    sandboxId: chat.sandboxId,
    branch: chat.branch,
    previewUrlPattern: null,
    createdSandbox: false,
  }
  const daytonaGet = vi.fn()
  const params = {
    daytona: { get: daytonaGet } as never,
    chat: chat as never,
    chatId: "chat-1",
    payload: {
      message: "hi",
      agent: "claude-code",
      model: "sonnet",
      userMessageId: "u1",
      assistantMessageId: "a1",
    } as never,
    githubToken: "ghtoken" as string | null,
    userId: "user-1",
    state,
  }
  return { chat, params, daytonaGet }
}

/** The DB update that records the new sandbox as ready. */
function readyUpdate() {
  return chatUpdate.mock.calls
    .map((c) => c[0] as { data?: Record<string, unknown> })
    .find((a) => a.data?.status === "ready")
}

beforeEach(() => {
  chatUpdate.mockReset().mockResolvedValue(undefined)
  createSandboxForChat.mockReset().mockResolvedValue({
    sandbox: freshSandbox,
    sandboxId: "sbx-new",
    branch: "agent/abcd1234",
    previewUrlPattern: null,
    repoName: "project",
    branchRestored: false,
  })
  ensureSandboxStarted.mockReset().mockResolvedValue(undefined)
  installSkillsForRepo.mockReset().mockResolvedValue({ installed: 0, total: 0 })
})

describe("ensureSandboxForChat — fresh creation (no sandbox yet)", () => {
  it("clears a stale session pointer so the agent does not resume a dead session", async () => {
    const { chat, params, daytonaGet } = setup({ sessionId: "stale-123" })
    daytonaGet.mockResolvedValue(freshSandbox)

    const result = await ensureSandboxForChat(params)

    expect(result).not.toBeInstanceOf(Response)
    expect(chat.sessionId).toBeNull()
    expect(readyUpdate()!.data).toHaveProperty("sessionId", null)
  })
})

describe("ensureSandboxForChat — deleted/dead sandbox recreation", () => {
  it("recreates when daytona.get 404s (fully deleted) and resets the session", async () => {
    const { chat, params, daytonaGet } = setup({
      sandboxId: "old-sbx",
      branch: "agent/work",
      sessionId: "stale-123",
    })
    daytonaGet.mockRejectedValue(new Error("404 not found"))

    const result = await ensureSandboxForChat(params)

    expect(result).not.toBeInstanceOf(Response)
    expect(createSandboxForChat).toHaveBeenCalledOnce()
    expect(chat.sessionId).toBeNull()
    expect(readyUpdate()!.data).toHaveProperty("sessionId", null)
  })

  it("recreates a dead-but-gettable sandbox (terminal state) instead of failing in start()", async () => {
    const { chat, params, daytonaGet } = setup({
      sandboxId: "old-sbx",
      branch: "agent/work",
      sessionId: "stale-123",
    })
    // get() resolves a sandbox mid-teardown — a state it can never start from.
    daytonaGet.mockResolvedValue({ id: "old-sbx", state: "destroying" })

    const result = await ensureSandboxForChat(params)

    expect(result).not.toBeInstanceOf(Response)
    // Must NOT have tried to start the dead sandbox.
    expect(ensureSandboxStarted).toHaveBeenCalledWith(freshSandbox)
    expect(createSandboxForChat).toHaveBeenCalledOnce()
    // Restores the existing branch.
    expect(createSandboxForChat.mock.calls[0][0]).toMatchObject({
      newBranch: "agent/work",
      restoreExistingBranch: true,
    })
    expect(chat.sessionId).toBeNull()
  })

  it("falls back to a fresh branch when the chat has no branch to restore", async () => {
    const { params, daytonaGet } = setup({
      sandboxId: "old-sbx",
      branch: null,
      sessionId: "stale-123",
    })
    daytonaGet.mockRejectedValue(new Error("404 not found"))

    const result = await ensureSandboxForChat(params)

    expect(result).not.toBeInstanceOf(Response)
    const arg = createSandboxForChat.mock.calls[0][0] as {
      newBranch: string
      restoreExistingBranch: boolean
    }
    expect(arg.restoreExistingBranch).toBe(false)
    expect(arg.newBranch).toMatch(/^agent\//)
  })

  it("reuses a live, startable sandbox without recreating", async () => {
    const { params, daytonaGet } = setup({
      sandboxId: "old-sbx",
      branch: "agent/work",
    })
    daytonaGet.mockResolvedValue({ id: "old-sbx", state: "stopped" })

    const result = await ensureSandboxForChat(params)

    expect(result).not.toBeInstanceOf(Response)
    expect(createSandboxForChat).not.toHaveBeenCalled()
    expect(ensureSandboxStarted).toHaveBeenCalledWith({ id: "old-sbx", state: "stopped" })
  })
})

describe("ensureSandboxForChat — unrecoverable cases", () => {
  it("returns 410 for a deleted local (NEW_REPOSITORY) sandbox", async () => {
    const { params, daytonaGet } = setup({
      sandboxId: "old-sbx",
      repo: "__new__",
    })
    daytonaGet.mockRejectedValue(new Error("404 not found"))

    const result = await ensureSandboxForChat(params)

    expect(result).toBeInstanceOf(Response)
    expect((result as Response).status).toBe(410)
    expect(createSandboxForChat).not.toHaveBeenCalled()
  })

  it("returns 410 when a cloned repo has no GitHub token to re-clone with", async () => {
    const { params, daytonaGet } = setup({
      sandboxId: "old-sbx",
      branch: "agent/work",
    })
    params.githubToken = null
    daytonaGet.mockRejectedValue(new Error("404 not found"))

    const result = await ensureSandboxForChat(params)

    expect(result).toBeInstanceOf(Response)
    expect((result as Response).status).toBe(410)
    expect(createSandboxForChat).not.toHaveBeenCalled()
  })
})
