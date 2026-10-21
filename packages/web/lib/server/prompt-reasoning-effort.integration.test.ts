import { afterAll, beforeAll, expect, it } from "vitest"
import { createTestUser, databaseDescribe, deleteTestUser } from "./db-test-helpers"

type Database = typeof import("@/lib/db/prisma").prisma
type Queue = typeof import("./prompt-queue")
let prisma: Database
let queue: Queue
let userId: string

databaseDescribe("per-prompt reasoning effort on the real server queue", () => {
  beforeAll(async () => {
    ;({ prisma, userId } = await createTestUser("reasoning-effort"))
    queue = await import("./prompt-queue")
  })
  afterAll(() => deleteTestUser(prisma, userId))
  const input = (reasoningEffort?: string) => ({ clientId: crypto.randomUUID(), content: `prompt-${reasoningEffort ?? "legacy"}`, agent: "codex", model: "gpt-6.1-sol", reasoningEffort })

  it("freezes each selection across concurrent submissions and one winning worker", async () => {
    const chat = await prisma.chat.create({ data: { userId, repo: "__new__", status: "ready" } })
    const entries = [input("low"), input("high"), input("default"), input()]
    await Promise.all(entries.map(entry => queue.enqueuePrompt(chat.id, entry)))
    const stored = await prisma.queuedPrompt.findMany({ where: { chatId: chat.id }, orderBy: { position: "asc" } })
    for (const entry of entries) expect(stored.find(row => row.clientId === entry.clientId)?.reasoningEffort).toBe(entry.reasoningEffort === "default" ? null : entry.reasoningEffort ?? null)
    const claims = await Promise.all([queue.claimNextPrompt(chat.id), queue.claimNextPrompt(chat.id)])
    expect(claims.filter(Boolean)).toHaveLength(1)
    expect(claims.find(Boolean)?.reasoningEffort).toBe(stored[0].reasoningEffort)
    expect(queue.toQueuedMessage(stored[0]).reasoningEffort).toBe(stored[0].reasoningEffort ?? undefined)
  })

  it("deduplicates retries but rejects a changed reasoning effort value for the same ID", async () => {
    const chat = await prisma.chat.create({ data: { userId, repo: "__new__", status: "ready" } })
    const entry = input("low")
    const [first, retry] = await Promise.all([queue.enqueuePrompt(chat.id, entry), queue.enqueuePrompt(chat.id, entry)])
    expect(first.id).toBe(retry.id)
    await expect(queue.enqueuePrompt(chat.id, { ...entry, reasoningEffort: "high" })).rejects.toThrow("different prompt")
    expect(await prisma.queuedPrompt.count({ where: { chatId: chat.id } })).toBe(1)
  })

  it("stores selections unchanged and treats a missing value and Default identically", async () => {
    const chat = await prisma.chat.create({ data: { userId, repo: "__new__", status: "ready" } })
    const entries = [input("high"), input()]
    for (const entry of entries) await queue.enqueuePrompt(chat.id, entry)
    const replay = await queue.enqueuePrompt(chat.id, { ...entries[1], reasoningEffort: "default" })
    expect(replay.reasoningEffort).toBeNull()
    const row = await prisma.queuedPrompt.findUniqueOrThrow({ where: { chatId_clientId: { chatId: chat.id, clientId: entries[0].clientId } } })
    expect(row.reasoningEffort).toBe("high")
  })

  it.each([
    { agent: "claude-code", model: "sonnet", reasoningEffort: "high", changed: "low" },
  ])("preserves $agent selections through enqueue and dispatch", async ({ changed, ...selection }) => {
    const chat = await prisma.chat.create({ data: { userId, repo: "__new__", status: "ready" } })
    const entry = { ...input(), ...selection }
    const replay = await queue.enqueuePrompt(chat.id, entry)
    expect(replay.reasoningEffort).toBe(selection.reasoningEffort)
    await expect(queue.enqueuePrompt(chat.id, { ...entry, reasoningEffort: changed })).rejects.toThrow("different prompt")
    const claim = await queue.claimNextPrompt(chat.id)
    expect(claim?.reasoningEffort).toBe(selection.reasoningEffort)
    expect(queue.toQueuedMessage(replay).reasoningEffort).toBe(selection.reasoningEffort)
  })
})
