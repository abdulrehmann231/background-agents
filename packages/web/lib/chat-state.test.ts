import { describe, expect, it } from "vitest"
import { nanoid } from "nanoid"
import { DRAFT_CHAT_ID_PREFIX, isDraftChatId } from "./chat-state"

describe("isDraftChatId", () => {
  it("recognises an id built with the draft prefix", () => {
    expect(isDraftChatId(`${DRAFT_CHAT_ID_PREFIX}${nanoid()}`)).toBe(true)
  })

  it("rejects a persisted chat id", () => {
    expect(isDraftChatId("cmg1x2y3z0000abcdefghijkl")).toBe(false)
  })

  it("rejects an id that only contains the prefix", () => {
    expect(isDraftChatId("chat-draft-123")).toBe(false)
  })

  it("treats a missing id as not a draft", () => {
    expect(isDraftChatId(null)).toBe(false)
    expect(isDraftChatId(undefined)).toBe(false)
  })
})
