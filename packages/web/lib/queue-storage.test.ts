import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { clearAllStorage, clearLocalStateForChats, loadLocalState, migrateDraftToRealChat, setCurrentChatId, setQueuedMessages } from "./storage"

const first = { id: "first", content: "offline A", pendingSync: true }
const second = { id: "second", content: "offline B", pendingSync: true }
let stored: Map<string, string>
beforeEach(() => {
  stored = new Map()
  vi.stubGlobal("window", {})
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
    key: (index: number) => [...stored.keys()][index] ?? null,
    get length() { return stored.size },
  })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe("per-message durable outbox ownership", () => {
  it("preserves two sends from tabs hydrated before either send", () => {
    setQueuedMessages("chat", [first], [])
    setQueuedMessages("chat", [second], [])
    expect(loadLocalState().queuedMessages.chat?.map((item) => item.id)).toEqual(["first", "second"])
  })

  it("acknowledges only the message owned by the caller's snapshot", () => {
    setQueuedMessages("chat", [first], [])
    setQueuedMessages("chat", [second], [])
    setQueuedMessages("chat", undefined, [first])
    expect(loadLocalState().queuedMessages.chat).toEqual([second])
  })

  it("does not resurrect an acknowledged message through a stale metadata update", () => {
    setQueuedMessages("chat", [first], [])
    setQueuedMessages("chat", undefined, [first])
    setQueuedMessages("chat", [{ ...first, syncError: "old failed request" }], [first])
    expect(loadLocalState().queuedMessages.chat ?? []).toEqual([])
  })

  it("does not clear another tab's cancellation intent with a late POST result", () => {
    setQueuedMessages("chat", [first], [])
    setQueuedMessages("chat", [{ ...first, cancelRequested: true }], [first])
    setQueuedMessages("chat", [{ ...first, userMessageId: "server-user" }], [first])
    expect(loadLocalState().queuedMessages.chat?.[0].cancelRequested).toBe(true)
  })

  it("keeps old browser queues readable without putting new outbox writes into that shared array", () => {
    stored.set("simple-chat-local", JSON.stringify({ queuedMessages: { chat: [first] } }))
    setQueuedMessages("chat", [first, second], [first])
    setQueuedMessages("chat", [second], [first, second])
    setCurrentChatId("another-chat")
    expect(loadLocalState().queuedMessages.chat).toEqual([second])
    const legacy = JSON.parse(stored.get("simple-chat-local")!)
    expect(legacy.queuedMessages.chat).not.toContainEqual(second)
  })

  it("clears all outbox records only when their chat is explicitly deleted", () => {
    setQueuedMessages("chat", [first], [])
    setQueuedMessages("other", [second], [])
    clearLocalStateForChats(["chat"])
    expect(loadLocalState().queuedMessages.chat).toBeUndefined()
    expect(loadLocalState().queuedMessages.other).toEqual([second])
  })

  it("moves draft outbox records and clears them with the existing clear-storage action", () => {
    setQueuedMessages("draft-1", [first], [])
    migrateDraftToRealChat("draft-1", "chat-1")
    expect(loadLocalState().queuedMessages["draft-1"]).toBeUndefined()
    expect(loadLocalState().queuedMessages["chat-1"]).toEqual([first])
    clearAllStorage()
    expect(loadLocalState().queuedMessages).toEqual({})
  })

  it("retains only failed records after a partial write and persists them when storage recovers", () => {
    const write = vi.spyOn(localStorage, "setItem").mockImplementation((key, value) => {
      if (key.endsWith(":second")) throw new Error("Full")
      stored.set(key, value)
    })
    expect(() => setQueuedMessages("chat", [first, second], [])).toThrow("Full")
    const memory = loadLocalState().queuedMessages.chat!
    expect(memory).toEqual([first, { ...second, deviceStorage: "memory-only" }])
    write.mockRestore()
    expect(setQueuedMessages("chat", memory, memory)).toEqual([first, second])
    expect([...stored.values()].join()).not.toContain("deviceStorage")
  })

  it("keeps a first prompt when the Storage object itself is unavailable until a later update", async () => {
    vi.resetModules()
    const fresh = await import("./storage")
    const usableStorage = localStorage
    vi.stubGlobal("localStorage", undefined)
    expect(() => fresh.setQueuedMessages("chat", [first], [])).toThrow()
    expect(fresh.loadLocalState().queuedMessages.chat?.[0]).toMatchObject({ ...first, deviceStorage: "memory-only" })
    vi.stubGlobal("localStorage", usableStorage)
    const copy = fresh.loadLocalState().queuedMessages.chat!
    expect(copy?.[0].content).toBe(first.content)
    expect(fresh.setQueuedMessages("chat", [{ ...copy[0], syncError: "Network failed" }], copy))
      .toEqual([{ ...first, syncError: "Network failed" }])
  })

  it("keeps prior and new items when a device read fails, then respects later deletion", () => {
    setQueuedMessages("chat", [first], [])
    const read = vi.spyOn(localStorage, "key").mockImplementation(() => { throw new Error("Read unavailable") })
    expect(() => setQueuedMessages("chat", [first, second], [first])).toThrow("Read unavailable")
    expect(loadLocalState().queuedMessages.chat?.map((item) => item.id)).toEqual(["first", "second"])
    read.mockRestore()
    // An older tab still uses physical deletion instead of a tombstone.
    stored.delete("simple-chat-queue:chat:first")
    expect(loadLocalState().queuedMessages.chat).toEqual([{ ...second, deviceStorage: "memory-only" }])
    const remaining = loadLocalState().queuedMessages.chat!
    expect(setQueuedMessages("chat", remaining, remaining)).toEqual([second])
  })

  it("never treats a partially readable outbox as an empty queue", () => {
    setQueuedMessages("chat", [first, second], [])
    const read = vi.spyOn(localStorage, "getItem").mockImplementation((key) => {
      if (key.endsWith(":second")) throw new Error("Read unavailable")
      return stored.get(key) ?? null
    })
    expect(loadLocalState().queuedMessages.chat).toEqual([first, second])
    read.mockRestore()
    stored.set("simple-chat-queue:chat:first", JSON.stringify({ item: null, order: 0 }))
    expect(loadLocalState().queuedMessages.chat).toEqual([second])
  })
  it("loads and updates healthy chat prompts despite an unrelated corrupt key on a cold page", async () => {
    stored.set("simple-chat-queue:chat:first", JSON.stringify({ item: first, order: 1 }))
    stored.set("simple-chat-queue:unrelated:broken", "{invalid JSON")
    vi.resetModules()
    const fresh = await import("./storage")
    expect(fresh.loadLocalState().queuedMessages.chat).toEqual([first])
    expect(fresh.setQueuedMessages("chat", [first, second], [first])).toEqual([first, second])
    expect(stored.get("simple-chat-queue:unrelated:broken")).toBe("{invalid JSON")
  })
  it("keeps a draft's memory fallback at its old ID if durable migration fails", () => {
    setQueuedMessages("draft-1", [first], [])
    vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("Full") })
    expect(() => setQueuedMessages("draft-1", [first, second], [first])).toThrow()
    expect(() => migrateDraftToRealChat("draft-1", "real")).toThrow()
    expect(loadLocalState().queuedMessages["draft-1"]?.map((item) => item.id)).toEqual(["first", "second"])
    expect(loadLocalState().queuedMessages.real).toBeUndefined()
  })
  it("does not partially remove draft prompts when a later migration copy fails", () => {
    setQueuedMessages("draft-1", [first, second], [])
    vi.spyOn(localStorage, "setItem").mockImplementation((key, value) => {
      if (key === "simple-chat-queue:real:second") throw new Error("Full")
      stored.set(key, value)
    })
    expect(() => migrateDraftToRealChat("draft-1", "real")).toThrow("Full")
    expect(loadLocalState().queuedMessages["draft-1"]).toEqual([first, second])
  })
  it("retains already-moved draft IDs in RAM if a later removal fails, then completes on retry", () => {
    setQueuedMessages("draft-1", [first, second], [])
    const remove = vi.spyOn(localStorage, "removeItem").mockImplementation((key) => {
      if (key === "simple-chat-queue:draft-1:second") throw new Error("Removal blocked")
      stored.delete(key)
    })
    expect(() => migrateDraftToRealChat("draft-1", "real")).toThrow("Removal blocked")
    expect(loadLocalState().queuedMessages["draft-1"]).toEqual([{ ...first, deviceStorage: "memory-only" }, second])
    remove.mockRestore()
    migrateDraftToRealChat("draft-1", "real")
    expect(loadLocalState().queuedMessages["draft-1"]).toBeUndefined()
    expect(loadLocalState().queuedMessages.real?.map((item) => item.id)).toEqual(["first", "second"])
  })

  it("preserves a legacy memory-only update when only the shared legacy record becomes unreadable", () => {
    stored.set("simple-chat-local", JSON.stringify({ queuedMessages: { chat: [first] } }))
    expect(loadLocalState().queuedMessages.chat).toEqual([first])
    vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("Full") })
    expect(() => setQueuedMessages("chat", [{ ...first, syncError: "offline" }], [first])).toThrow()
    vi.spyOn(localStorage, "getItem").mockImplementation((key) => {
      if (key === "simple-chat-local") throw new Error("Read unavailable")
      return stored.get(key) ?? null
    })
    expect(loadLocalState().queuedMessages.chat?.[0]).toMatchObject({ ...first, syncError: "offline", deviceStorage: "memory-only" })
  })

  it("honors another tab's tombstone over a never-durable local copy", () => {
    const write = vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("Full") })
    expect(() => setQueuedMessages("chat", [first], [])).toThrow()
    const stale = loadLocalState().queuedMessages.chat!
    write.mockRestore()
    stored.set("simple-chat-queue:chat:first", JSON.stringify({ item: null, order: 0 }))
    expect(setQueuedMessages("chat", [{ ...stale[0], syncError: "late failure" }], stale)).toEqual([])
    expect(loadLocalState().queuedMessages.chat ?? []).toEqual([])
  })

  it("keeps a failed removal authoritative even if a stale update arrives before storage recovers", () => {
    setQueuedMessages("chat", [first], [])
    const write = vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("Full") })
    expect(() => setQueuedMessages("chat", [], [first])).toThrow()
    expect(() => setQueuedMessages("chat", [{ ...first, syncError: "late result" }], [first])).toThrow()
    expect(loadLocalState().queuedMessages.chat ?? []).toEqual([])
    write.mockRestore()
    setQueuedMessages("chat", [second], [])
    expect(loadLocalState().queuedMessages.chat).toEqual([second])
    expect(JSON.parse(stored.get("simple-chat-queue:chat:first")!).item).toBeNull()
  })

  it("keeps another tab's cancellation while a local metadata update is memory-only", () => {
    setQueuedMessages("chat", [first], [])
    const write = vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("Full") })
    expect(() => setQueuedMessages("chat", [{ ...first, syncError: "offline" }], [first])).toThrow()
    write.mockRestore()
    stored.set("simple-chat-queue:chat:first", JSON.stringify({ item: { ...first, cancelRequested: true }, order: 1 }))
    expect(loadLocalState().queuedMessages.chat?.[0]).toMatchObject({ cancelRequested: true, syncError: "offline" })
  })

  it("keeps memory-only queues when unrelated device state changes and migrates or clears only their chat", () => {
    const write = vi.spyOn(localStorage, "setItem").mockImplementation((key, value) => {
      if (key.startsWith("simple-chat-queue:")) throw new Error("Full")
      stored.set(key, value)
    })
    expect(() => setQueuedMessages("draft-1", [first], [])).toThrow()
    expect(() => setQueuedMessages("other", [second], [])).toThrow()
    setCurrentChatId("other")
    migrateDraftToRealChat("draft-1", "real")
    expect(loadLocalState().queuedMessages.real?.[0]).toMatchObject(first)
    expect(loadLocalState().queuedMessages["draft-1"]).toBeUndefined()
    clearLocalStateForChats(["real"])
    expect(loadLocalState().queuedMessages.real).toBeUndefined()
    expect(loadLocalState().queuedMessages.other?.[0]).toMatchObject(second)
    write.mockRestore()
    clearAllStorage()
    expect(loadLocalState().queuedMessages).toEqual({})
  })

  it("surfaces a blocked device write so the caller can keep the prompt in memory and warn", () => {
    vi.stubGlobal("localStorage", { getItem: () => null, key: () => null, length: 0,
      setItem: () => { throw new Error("Storage quota exceeded") } })
    expect(() => setQueuedMessages("chat", [first], [])).toThrow("Storage quota exceeded")
    expect(loadLocalState().queuedMessages.chat).toEqual([{ ...first, deviceStorage: "memory-only" }])
  })
})
