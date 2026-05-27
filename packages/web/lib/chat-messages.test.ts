import { describe, it, expect } from "vitest"
import type { Chat, ChatStatus, Message, Settings, CredentialFlags } from "@/lib/types"
import { NEW_REPOSITORY } from "@/lib/types"
import type { SettingsData } from "@/lib/query"
import {
  resolveAgentAndModel,
  usesSharedClaudePool,
  newBranchForSend,
  applyOptimisticSend,
  removeOptimisticMessages,
  applySendSuccess,
  applySendError,
  decrementClaudeUsage,
  type SendMessageResponse,
} from "@/lib/chat-messages"

function chat(overrides: Partial<Chat> & { id: string }): Chat {
  return {
    repo: NEW_REPOSITORY,
    baseBranch: "main",
    branch: null,
    sandboxId: null,
    sessionId: null,
    messages: [],
    createdAt: 0,
    updatedAt: 0,
    status: "ready" as ChatStatus,
    displayName: null,
    ...overrides,
  } as Chat
}

function msg(id: string, role: Message["role"] = "user"): Message {
  return { id, role, content: `c-${id}`, timestamp: 0 }
}

const settings: Pick<Settings, "defaultAgent" | "defaultModel"> = {
  defaultAgent: "codex",
  defaultModel: "gpt-5",
}

function flags(overrides: CredentialFlags = {}): CredentialFlags {
  return overrides
}

const response: SendMessageResponse = {
  sandboxId: "sb1",
  branch: "agent/x",
  previewUrlPattern: null,
  backgroundSessionId: "bg1",
  uploadedFiles: [],
}

describe("resolveAgentAndModel", () => {
  it("prefers explicit args", () => {
    const r = resolveAgentAndModel("opencode", "m1", chat({ id: "a", agent: "codex", model: "m2" }), settings, flags())
    expect(r).toEqual({ agent: "opencode", model: "m1" })
  })

  it("falls back to the chat's agent/model", () => {
    const r = resolveAgentAndModel(undefined, undefined, chat({ id: "a", agent: "goose", model: "m9" }), settings, flags())
    expect(r).toEqual({ agent: "goose", model: "m9" })
  })

  it("falls back to user default settings when chat has none", () => {
    const r = resolveAgentAndModel(undefined, undefined, chat({ id: "a" }), settings, flags())
    expect(r).toEqual({ agent: "codex", model: "gpt-5" })
  })
})

describe("usesSharedClaudePool", () => {
  it("is false for non-claude agents", () => {
    expect(usesSharedClaudePool("codex", flags({ CLAUDE_SHARED_POOL_AVAILABLE: true }))).toBe(false)
  })

  it("is false when the user has their own Anthropic credentials", () => {
    expect(usesSharedClaudePool("claude-code", flags({ CLAUDE_SHARED_POOL_AVAILABLE: true, ANTHROPIC_API_KEY: true }))).toBe(false)
    expect(usesSharedClaudePool("claude-code", flags({ CLAUDE_SHARED_POOL_AVAILABLE: true, CLAUDE_CODE_CREDENTIALS: true }))).toBe(false)
  })

  it("is false when the shared pool is unavailable", () => {
    expect(usesSharedClaudePool("claude-code", flags({}))).toBe(false)
  })

  it("is true for claude-code with shared pool and no own credentials", () => {
    expect(usesSharedClaudePool("claude-code", flags({ CLAUDE_SHARED_POOL_AVAILABLE: true }))).toBe(true)
  })
})

describe("newBranchForSend", () => {
  it("returns undefined when a sandbox already exists", () => {
    expect(newBranchForSend({ sandboxId: "sb1" })).toBeUndefined()
  })

  it("returns a fresh agent/ branch when there is no sandbox", () => {
    expect(newBranchForSend({ sandboxId: null })).toMatch(/^agent\//)
  })
})

describe("applyOptimisticSend", () => {
  it("appends both messages and goes to creating when there is no sandbox", () => {
    const result = applyOptimisticSend(chat({ id: "a" }), msg("u"), msg("as", "assistant"), 123)
    expect(result.messages.map((m) => m.id)).toEqual(["u", "as"])
    expect(result.status).toBe("creating")
    expect(result.lastActiveAt).toBe(123)
    expect(result.errorMessage).toBeUndefined()
  })

  it("goes to running when a sandbox already exists", () => {
    const result = applyOptimisticSend(chat({ id: "a", sandboxId: "sb1" }), msg("u"), msg("as", "assistant"), 1)
    expect(result.status).toBe("running")
  })
})

describe("removeOptimisticMessages", () => {
  it("drops the given message ids and returns to ready", () => {
    const base = chat({ id: "a", status: "creating", messages: [msg("keep"), msg("u"), msg("as", "assistant")] })
    const result = removeOptimisticMessages(base, ["u", "as"])
    expect(result.messages.map((m) => m.id)).toEqual(["keep"])
    expect(result.status).toBe("ready")
  })
})

describe("applySendSuccess", () => {
  it("applies sandbox/branch/session info and sets running", () => {
    const result = applySendSuccess(chat({ id: "a", messages: [msg("u")] }), response, "claude-code", "sonnet", "u")
    expect(result.sandboxId).toBe("sb1")
    expect(result.branch).toBe("agent/x")
    expect(result.backgroundSessionId).toBe("bg1")
    expect(result.agent).toBe("claude-code")
    expect(result.model).toBe("sonnet")
    expect(result.status).toBe("running")
  })

  it("attaches uploaded files to the user message only when present", () => {
    const withFiles: SendMessageResponse = { ...response, uploadedFiles: ["f.png"] }
    const result = applySendSuccess(chat({ id: "a", messages: [msg("u"), msg("as", "assistant")] }), withFiles, "codex", "m", "u")
    const user = result.messages.find((m) => m.id === "u")
    expect(user?.uploadedFiles).toEqual(["f.png"])
    expect(result.messages.find((m) => m.id === "as")?.uploadedFiles).toBeUndefined()
  })
})

describe("applySendError", () => {
  it("marks the chat errored and annotates the assistant message", () => {
    const result = applySendError(chat({ id: "a", messages: [msg("u"), msg("as", "assistant")] }), "as", "boom")
    expect(result.status).toBe("error")
    expect(result.errorMessage).toBe("boom")
    const assistant = result.messages.find((m) => m.id === "as")
    expect(assistant?.content).toBe("Error: boom")
    expect(assistant?.isError).toBe(true)
  })
})

describe("decrementClaudeUsage", () => {
  it("returns undefined unchanged", () => {
    expect(decrementClaudeUsage(undefined)).toBeUndefined()
  })

  it("leaves data with unknown usage unchanged", () => {
    const data = { claudeLimitUsed: null, claudeLimitRemaining: null } as unknown as SettingsData
    expect(decrementClaudeUsage(data)).toBe(data)
  })

  it("increments used and decrements remaining", () => {
    const data = { claudeLimitUsed: 5, claudeLimitRemaining: 10 } as unknown as SettingsData
    const result = decrementClaudeUsage(data)
    expect(result?.claudeLimitUsed).toBe(6)
    expect(result?.claudeLimitRemaining).toBe(9)
  })

  it("floors remaining at zero and keeps null remaining null", () => {
    expect(decrementClaudeUsage({ claudeLimitUsed: 5, claudeLimitRemaining: 0 } as unknown as SettingsData)?.claudeLimitRemaining).toBe(0)
    expect(decrementClaudeUsage({ claudeLimitUsed: 5, claudeLimitRemaining: null } as unknown as SettingsData)?.claudeLimitRemaining).toBeNull()
  })
})
