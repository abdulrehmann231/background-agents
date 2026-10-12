import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { acknowledgeDirectSends, dismissDirectSend, markDirectSendUnconfirmed, retainDirectSend } from "./direct-send-recovery"
import { loadLocalState } from "./storage"
import { useChatSyncStore } from "./stores/chat-sync-store"
import { useToastStore } from "./stores/toast-store"
import { getPendingSubmission, hasActiveQueue, mergeLocalState } from "./chat-state"
import type { Chat, QueuedMessage } from "./types"

const intent: QueuedMessage = { id: "user-1", userMessageId: "user-1", content: "Original prompt", syncFailed: true,
  directSend: { assistantMessageId: "assistant-1", timestamp: 1, attachmentNames: ["notes.txt"] } }
beforeEach(() => {
  const stored = new Map<string, string>()
  vi.stubGlobal("window", {})
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
    key: (index: number) => [...stored.keys()][index] ?? null,
    get length() { return stored.size },
  })
  useChatSyncStore.setState({ isHydrated: false, localChatState: { previewStates: {}, drafts: {}, queuePaused: {}, queuedMessages: {} } })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe("direct send retention is not a retry queue", () => {
  it("retains text and attachment names across hydration without changing a newer draft", () => {
    retainDirectSend("chat", intent)
    useChatSyncStore.getState().setDraftText("chat", "Newer draft")
    markDirectSendUnconfirmed("chat", intent.id, "Gateway did not respond")
    useChatSyncStore.getState().hydrate()
    const state = useChatSyncStore.getState().localChatState
    expect(state.drafts.chat).toBe("Newer draft")
    expect(state.queuedMessages.chat?.[0]).toMatchObject({ content: "Original prompt", directSend: { error: "Gateway did not respond", attachmentNames: ["notes.txt"] } })
  })
  it("does not acknowledge a missing or unrelated server message", () => {
    retainDirectSend("chat", intent)
    acknowledgeDirectSends("chat", [])
    acknowledgeDirectSends("chat", [{ id: "user-1", role: "assistant" }, { id: "other-user", role: "user" }])
    expect(loadLocalState().queuedMessages.chat).toHaveLength(1)
    acknowledgeDirectSends("chat", [{ id: "user-1", role: "user" }])
    expect(loadLocalState().queuedMessages.chat ?? []).toHaveLength(0)
  })
  it("keeps recovery distinct from waiting work and its loading indicators", () => {
    retainDirectSend("chat", intent)
    const chat = { id: "chat", status: "error", messages: [] } as unknown as Chat
    const merged = mergeLocalState([chat], useChatSyncStore.getState().localChatState)[0]
    expect(merged.queuedMessages).toEqual([])
    expect(merged.directSendRecovery).toEqual([intent])
    expect(hasActiveQueue({ status: "ready", queuedMessages: [intent] })).toBe(false)
    expect(getPendingSubmission({ ...chat, status: "ready", queuedMessages: [intent] })).toBeUndefined()
  })
  it("dismisses only the chosen local direct copy, without a fetch or deleting queued work", () => {
    const fetch = vi.fn()
    vi.stubGlobal("fetch", fetch)
    retainDirectSend("chat", { id: "queued", content: "Other pending prompt" })
    retainDirectSend("chat", intent)
    dismissDirectSend("chat", intent.id)
    expect(loadLocalState().queuedMessages.chat?.map((item) => item.id)).toEqual(["queued"])
    expect(fetch).not.toHaveBeenCalled()
  })
  it("reports failed durable storage while retaining text in memory", () => {
    vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("Storage quota exceeded") })
    expect(retainDirectSend("chat", intent)).toBe(false)
    expect(useChatSyncStore.getState().localChatState.queuedMessages.chat?.[0]).toMatchObject(intent)
  })
  it.each([false, true])("retains a failed direct send across error updates and hydration (storage restored=%s)", (restored) => {
    const write = vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("Storage quota exceeded") })
    expect(retainDirectSend("chat", intent)).toBe(false)
    if (restored) write.mockRestore()
    markDirectSendUnconfirmed("chat", intent.id, "The send failed")
    useChatSyncStore.getState().hydrate()
    const kept = useChatSyncStore.getState().localChatState.queuedMessages.chat?.[0]
    expect(kept).toMatchObject({ ...intent, directSend: { ...intent.directSend, error: "The send failed" } })
    expect(kept?.deviceStorage).toBe(restored ? undefined : "memory-only")
  })
  it("clears only an exactly acknowledged memory-only prompt and never replays it", () => {
    const fetch = vi.fn()
    vi.stubGlobal("fetch", fetch)
    vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("Storage quota exceeded") })
    retainDirectSend("chat", intent)
    retainDirectSend("chat", { ...intent, id: "other", userMessageId: "other", content: "Other prompt" })
    acknowledgeDirectSends("chat", [{ id: intent.id, role: "user" }])
    useChatSyncStore.getState().hydrate()
    expect(useChatSyncStore.getState().localChatState.queuedMessages.chat?.map((item) => item.id)).toEqual(["other"])
    expect(fetch).not.toHaveBeenCalled()
  })
  it("preserves a newer unsaved draft and an intentional clear across in-tab rehydration", () => {
    useChatSyncStore.getState().hydrate()
    useChatSyncStore.getState().setDraftText("chat", "Older saved draft")
    vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("Storage quota exceeded") })
    retainDirectSend("chat", intent)
    useChatSyncStore.getState().setDraftText("chat", "Newer unsaved draft")
    markDirectSendUnconfirmed("chat", intent.id, "Network failed")
    useChatSyncStore.getState().hydrate()
    expect(useChatSyncStore.getState().localChatState.drafts.chat).toBe("Newer unsaved draft")
    useChatSyncStore.getState().setDraftText("chat", undefined)
    useChatSyncStore.getState().hydrate()
    expect(useChatSyncStore.getState().localChatState.drafts.chat).toBeUndefined()
    expect(useChatSyncStore.getState().localChatState.queuedMessages.chat?.[0].content).toBe(intent.content)
  })
  it("warns once for a new memory-only copy, not for repeated error updates or acknowledgement", () => {
    const toast = vi.spyOn(useToastStore.getState(), "addToast")
    vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("Full") })
    retainDirectSend("chat", intent)
    markDirectSendUnconfirmed("chat", intent.id, "Network failed")
    markDirectSendUnconfirmed("chat", intent.id, "Still unconfirmed")
    acknowledgeDirectSends("chat", [{ id: intent.id, role: "user" }])
    expect(toast).toHaveBeenCalledTimes(1)
  })
})
