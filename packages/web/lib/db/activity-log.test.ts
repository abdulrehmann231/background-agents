import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock the prisma singleton so logLlmProviderError can be exercised without a
// DB. `vi.hoisted` lets the factory (hoisted above imports) see the mock.
const { activityLog } = vi.hoisted(() => ({
  activityLog: { create: vi.fn() },
}))
vi.mock("@/lib/db/prisma", () => ({ prisma: { activityLog } }))

// Mock next/headers so logActivity's IP capture is deterministic in tests —
// the real headers() throws outside an active Next.js request scope, which
// every test here is.
const { mockHeaders } = vi.hoisted(() => ({
  mockHeaders: vi.fn(async () => new Headers()),
}))
vi.mock("next/headers", () => ({ headers: mockHeaders }))

import { logActivity, logLlmProviderError, logGitPushError } from "./activity-log"

// logActivityAsync is fire-and-forget; flush the microtask queue so the
// create() call has run before we assert.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  activityLog.create.mockReset()
  activityLog.create.mockResolvedValue({})
  mockHeaders.mockReset()
  mockHeaders.mockResolvedValue(new Headers())
})

describe("logActivity", () => {
  it("attaches the client IP from x-forwarded-for when available", async () => {
    mockHeaders.mockResolvedValue(new Headers({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" }))

    await logActivity("u1", "login")

    expect(activityLog.create).toHaveBeenCalledTimes(1)
    const { data } = activityLog.create.mock.calls[0][0]
    expect(data.metadata).toEqual({ ip: "1.2.3.4" })
  })

  it("omits metadata entirely when no ip and no other metadata is available", async () => {
    await logActivity("u1", "login")

    const { data } = activityLog.create.mock.calls[0][0]
    expect(data.metadata).toBeUndefined()
  })

  it("does not overwrite an explicitly provided ip", async () => {
    mockHeaders.mockResolvedValue(new Headers({ "x-forwarded-for": "9.9.9.9" }))

    await logActivity("u1", "login", { ip: "explicit" })

    const { data } = activityLog.create.mock.calls[0][0]
    expect(data.metadata.ip).toBe("explicit")
  })

  it("merges the captured ip alongside other metadata", async () => {
    mockHeaders.mockResolvedValue(new Headers({ "x-forwarded-for": "1.2.3.4" }))

    await logActivity("u1", "chat_created", { chatId: "c1" })

    const { data } = activityLog.create.mock.calls[0][0]
    expect(data.metadata).toEqual({ chatId: "c1", ip: "1.2.3.4" })
  })
})

describe("logLlmProviderError", () => {
  it("records a provider error and classifies its category", async () => {
    logLlmProviderError({
      userId: "u1",
      agent: "opencode",
      model: "gpt-5",
      chatId: "c1",
      source: "stream",
      error: "AI_APICallError: insufficient balance (402)",
    })
    await flush()

    expect(activityLog.create).toHaveBeenCalledTimes(1)
    const { data } = activityLog.create.mock.calls[0][0]
    expect(data.userId).toBe("u1")
    expect(data.action).toBe("llm_provider_error")
    expect(data.metadata).toMatchObject({
      category: "balance",
      agent: "opencode",
      model: "gpt-5",
      chatId: "c1",
      source: "stream",
    })
    expect(data.metadata.message).toContain("insufficient balance")
  })

  it("skips a bare process crash that carries no provider detail", async () => {
    logLlmProviderError({
      userId: "u1",
      agent: "claude-code",
      source: "cron-interactive",
      error: "Process exited without completing",
      errorKind: "crash",
    })
    await flush()

    expect(activityLog.create).not.toHaveBeenCalled()
  })

  it("still records a crash when its captured detail is a real provider failure", async () => {
    logLlmProviderError({
      userId: "u1",
      agent: "claude-code",
      source: "cron-interactive",
      error: "Process exited without completing\n\nInvalid API key: 401 Unauthorized",
      errorKind: "crash",
    })
    await flush()

    expect(activityLog.create).toHaveBeenCalledTimes(1)
    const { data } = activityLog.create.mock.calls[0][0]
    expect(data.metadata.category).toBe("auth")
  })
})

describe("logGitPushError", () => {
  it("records a push failure with chat and branch context", async () => {
    logGitPushError({
      userId: "u1",
      chatId: "c1",
      branch: "feature/foo",
      error: "unable to access 'https://github.com/x/y.git': Could not resolve host",
    })
    await flush()

    expect(activityLog.create).toHaveBeenCalledTimes(1)
    const { data } = activityLog.create.mock.calls[0][0]
    expect(data.userId).toBe("u1")
    expect(data.action).toBe("git_push_failed")
    expect(data.metadata).toMatchObject({
      chatId: "c1",
      branch: "feature/foo",
    })
    expect(data.metadata.message).toContain("Could not resolve host")
  })

  it("truncates very long error output", async () => {
    logGitPushError({
      userId: "u1",
      chatId: "c1",
      branch: "main",
      error: "x".repeat(1000),
    })
    await flush()

    const { data } = activityLog.create.mock.calls[0][0]
    expect(data.metadata.message).toHaveLength(501) // 500 chars + the "…" ellipsis
    expect(data.metadata.message.endsWith("…")).toBe(true)
  })
})
