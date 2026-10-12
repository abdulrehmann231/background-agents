import type { QueuedMessage } from "./types"

const PREFIX = "simple-chat-queue:"
type RecordValue = { item: QueuedMessage | null; order: number }
type QueueMap = Record<string, QueuedMessage[] | undefined>
const keyFor = (chatId: string, id: string) => `${PREFIX}${encodeURIComponent(chatId)}:${encodeURIComponent(id)}`
type OutboxRecord = { key: string; chatId: string; id: string; value: RecordValue }
type PendingRecord = OutboxRecord & { wasStored: boolean }

// This is only a fallback for failed device writes, never another send queue.
// Storage remains authoritative for saved IDs and cross-tab removals. Keeping
// failed mutations here also protects them across in-tab hydration/navigation.
let storageOwner: Storage | undefined
const pending = new Map<string, PendingRecord>()
const lastRead = new Map<string, OutboxRecord>()

function deviceStorage() {
  const storage = localStorage
  if (storageOwner !== storage) {
    // The getter itself can be blocked initially. Its first successful access
    // must not erase prompts retained while no Storage object was available.
    if (storageOwner) {
      pending.clear()
      lastRead.clear()
    }
    storageOwner = storage
  }
  return storage
}

function withoutStorageFlag(item: QueuedMessage): QueuedMessage {
  const { deviceStorage: _, ...stored } = item
  return stored
}

function records(): { entries: OutboxRecord[]; unreadable: Map<string, unknown>; error?: unknown } {
  const unreadable = new Map<string, unknown>()
  if (typeof window === "undefined") return { entries: [], unreadable }
  const result: OutboxRecord[] = []
  try {
    const storage = deviceStorage()
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index)
      if (!key?.startsWith(PREFIX)) continue
      try {
        const [chatId, id] = key.slice(PREFIX.length).split(":").map(decodeURIComponent)
        const value = JSON.parse(storage.getItem(key) ?? "null") as RecordValue | null
        if (chatId && id && value && typeof value.order === "number" &&
            (value.item === null || value.item?.id === id)) result.push({ key, chatId, id, value })
        else if (value !== null) throw new Error("Unreadable local prompt record")
      } catch (error) {
        // One corrupt/blocked key must not hide other chats. Retain its last
        // readable copy, but do not overwrite it or infer deletion from it.
        unreadable.set(key, error)
        const cached = lastRead.get(key)
        if (cached) result.push(cached)
      }
    }
  } catch (error) {
    // An unavailable/partially read device is not evidence that IDs were deleted.
    return { entries: [...lastRead.values()], unreadable, error }
  }
  lastRead.clear()
  for (const record of result) lastRead.set(record.key, record)
  return { entries: result, unreadable }
}

/** Separate keys make writes to different prompt IDs independent across tabs. */
export function readQueueOutbox(legacy: QueueMap): QueueMap {
  const queues = new Map<string, Map<string, RecordValue>>()
  for (const [chatId, items] of Object.entries(legacy)) {
    queues.set(chatId, new Map(items?.map((item, order) => [item.id, { item, order }]) ?? []))
  }
  const snapshot = records()
  const stored = new Map(snapshot.entries.map((record) => [record.key, record]))
  for (const record of snapshot.entries) {
    const items = queues.get(record.chatId) ?? new Map<string, RecordValue>()
    if (record.value.item) items.set(record.id, record.value)
    else items.delete(record.id)
    queues.set(record.chatId, items)
  }
  for (const [key, record] of pending) {
    const durable = stored.get(key)?.value
    const legacyItem = legacy[record.chatId]?.some((item) => item.id === record.id)
    if (!snapshot.error && !snapshot.unreadable.has(key) && record.value.item && (durable?.item === null ||
      // Compatibility with older tabs, which physically removed saved keys.
      (record.wasStored && !durable && !legacyItem))) {
      pending.delete(key)
      continue
    }
    const items = queues.get(record.chatId) ?? new Map<string, RecordValue>()
    if (record.value.item) items.set(record.id, {
      ...record.value, item: { ...record.value.item, deviceStorage: "memory-only",
        ...(durable?.item?.cancelRequested && !record.value.item.cancelFailed ? { cancelRequested: true } : {}),
      },
    })
    else items.delete(record.id)
    queues.set(record.chatId, items)
  }
  return Object.fromEntries([...queues].map(([chatId, items]) => [chatId,
    [...items.values()].sort((a, b) => a.order - b.order || a.item!.id.localeCompare(b.item!.id)).map((entry) => entry.item!),
  ]))
}

/** Apply only this caller's changes; never replace another tab's queue array. */
export function patchQueueOutbox(chatId: string, previous: QueuedMessage[], next: QueuedMessage[], legacy: QueuedMessage[]) {
  if (typeof window === "undefined") return
  const before = new Map(previous.map((item) => [item.id, item]))
  const after = new Map(next.map((item) => [item.id, item]))
  const snapshot = records()
  const currentRecords = snapshot.entries.filter((record) => record.chatId === chatId)
  const current = new Map(currentRecords.map((record) => [record.id, record.value]))
  let failure = snapshot.error
  let order = Math.max(Date.now(), ...currentRecords.map((record) => record.value.order + 1))
  const write = (record: PendingRecord) => {
    pending.set(record.key, record)
    if (snapshot.error || snapshot.unreadable.has(record.key)) {
      failure ??= snapshot.unreadable.get(record.key)
      return // Do not overwrite an unreadable cross-tab record.
    }
    try {
      deviceStorage().setItem(record.key, JSON.stringify(record.value))
      lastRead.set(record.key, record)
      pending.delete(record.key)
    } catch (error) { failure = error }
  }
  for (const item of next) {
    const key = keyFor(chatId, item.id)
    const fallback = pending.get(key)
    if (JSON.stringify(before.get(item.id)) === JSON.stringify(item) && !fallback && !snapshot.error && !snapshot.unreadable.has(key)) continue
    const stored = current.get(item.id)
    const legacyIndex = legacy.findIndex((entry) => entry.id === item.id)
    // Another tab already acknowledged/deleted this ID. A stale metadata update
    // must not recreate it. New sends always have a fresh client request ID.
    if (fallback?.value.item === null) {
      write(fallback)
      continue
    }
    if (!snapshot.error && !snapshot.unreadable.has(key) && (stored?.item === null ||
      (before.has(item.id) && !stored && legacyIndex < 0 && fallback?.wasStored !== false))) {
      pending.delete(key)
      continue
    }
    const updated = {
      ...withoutStorageFlag(item),
      // A late POST result cannot undo a removal requested in another tab.
      ...(stored?.item?.cancelRequested && !item.cancelFailed ? { cancelRequested: true } : {}),
    }
    write({ key, chatId, id: item.id,
      wasStored: fallback?.wasStored ?? (!!stored?.item || legacyIndex >= 0 || before.has(item.id)),
      value: { item: updated, order: fallback?.value.order ?? stored?.order ?? (legacyIndex >= 0 ? legacyIndex : order++) },
    })
  }
  const removals = new Set([...before.keys(), ...[...pending.values()]
    .filter((record) => record.chatId === chatId && record.value.item === null).map((record) => record.id)])
  for (const id of removals) {
    if (after.has(id)) continue
    // Explicit removal also defeats a failed first write still held by another
    // tab. Missing keys alone cannot distinguish that case from never saved.
    write({ key: keyFor(chatId, id), chatId, id, wasStored: true, value: { item: null, order: 0 } })
  }
  if (failure) throw failure
}

export function clearQueueOutbox(chatIds?: string[]) {
  const snapshot = records()
  for (const [key, record] of pending) if (!chatIds || chatIds.includes(record.chatId)) pending.delete(key)
  for (const record of snapshot.entries) if (!chatIds || chatIds.includes(record.chatId)) {
    deviceStorage().removeItem(record.key)
    lastRead.delete(record.key)
  }
  if (snapshot.error) throw snapshot.error
}

export function migrateQueueOutbox(fromId: string, toId: string) {
  const snapshot = records()
  if (snapshot.error) throw snapshot.error
  for (const [key, error] of snapshot.unreadable) {
    if (key.startsWith(`${PREFIX}${encodeURIComponent(fromId)}:`)) throw error
  }
  // Complete device I/O before moving the in-memory fallback. If it fails,
  // the caller still owns the draft ID and must be able to find its prompt.
  const source = snapshot.entries.filter((record) => record.chatId === fromId)
  const removed: OutboxRecord[] = []
  try {
    // Copy all first, so a later quota failure cannot partially empty the draft.
    for (const record of source) {
      const target = keyFor(toId, record.id)
      if (!localStorage.getItem(target)) localStorage.setItem(target, JSON.stringify(record.value))
    }
    for (const record of source) {
      localStorage.removeItem(record.key)
      removed.push(record)
    }
  } catch (error) {
    // A removal can fail too. Restore only the IDs this operation removed to
    // RAM under the still-active draft ID; do not infer a cross-tab deletion.
    for (const record of removed) {
      pending.set(record.key, { ...record, value: pending.get(record.key)?.value ?? record.value, wasStored: false })
    }
    throw error
  }
  for (const [key, record] of pending) {
    if (record.chatId !== fromId) continue
    const target = keyFor(toId, record.id)
    pending.set(target, { ...record, key: target, chatId: toId, wasStored: false })
    pending.delete(key)
  }
}
