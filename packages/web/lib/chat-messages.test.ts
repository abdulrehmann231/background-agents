import { afterEach, describe, expect, it, vi } from "vitest"
import { sendMessageToApi } from "./chat-messages"

describe("sendMessageToApi", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("preserves what the limit dialog needs from a 429", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      Response.json({
        error: "DAILY_LIMIT_EXCEEDED",
        provider: "gemini",
        creditBalance: -1.5,
      }, { status: 429 })
    ))

    const result = await sendMessageToApi("chat-1", {
      message: "Continue",
      agent: "gemini",
      model: "gemini-2.5-flash",
      userMessageId: "user-1",
      assistantMessageId: "assistant-1",
    })

    expect(result).toMatchObject({
      ok: false,
      isDailyLimit: true,
      provider: "gemini",
      creditBalance: -1.5,
    })
  })

  it("ignores a non-numeric creditBalance rather than passing it through", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      Response.json({
        error: "DAILY_LIMIT_EXCEEDED",
        provider: "claude",
        creditBalance: "lots",
      }, { status: 429 })
    ))

    const result = await sendMessageToApi("chat-1", {
      message: "Continue",
      agent: "claude",
      model: "claude-opus-5",
      userMessageId: "user-1",
      assistantMessageId: "assistant-1",
    })

    expect(result).toMatchObject({ ok: false, isDailyLimit: true })
    expect((result as { creditBalance?: unknown }).creditBalance).toBeUndefined()
  })
})
