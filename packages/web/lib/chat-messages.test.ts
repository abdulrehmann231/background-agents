import { afterEach, describe, expect, it, vi } from "vitest"
import { sendMessageToApi } from "./chat-messages"

describe("sendMessageToApi", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("preserves the subscription plan from a daily-limit response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      Response.json({
        error: "DAILY_LIMIT_EXCEEDED",
        plan: "pro",
        provider: "gemini",
        unit: "messages",
        used: 200,
        limit: 200,
        resetAt: "2026-08-02T00:00:00.000Z",
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
      plan: "pro",
      provider: "gemini",
      limit: 200,
    })
  })
})
