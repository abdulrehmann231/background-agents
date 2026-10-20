import { afterAll, beforeAll, expect, it } from "vitest"
import { createTestUser, databaseDescribe, deleteTestUser } from "./db-test-helpers"

type Database = typeof import("@/lib/db/prisma").prisma
type Queue = typeof import("./prompt-queue")
let prisma: Database
let queue: Queue
let userId: string
const run = crypto.randomUUID()

databaseDescribe("idempotent prompt cancellation on a real database", () => {
  beforeAll(async () => {
    ;({ prisma, userId } = await createTestUser("queue-cancel"))
    queue = await import("./prompt-queue")
  })
  afterAll(() => deleteTestUser(prisma, userId))
  const input = (clientId: string) => ({ clientId, content: "cancel this prompt", agent: "eliza", model: "eliza-classic-1.0" })

  it("remembers removal before a delayed send arrives", async () => {
    const chat = await prisma.chat.create({ data: { userId, repo: "__new__", status: "ready" } })
    const prompt = input(`before-${run}`)
    expect(await queue.cancelQueuedPrompt(chat.id, { clientId: prompt.clientId })).toBe(true)
    expect((await queue.enqueuePrompt(chat.id, prompt)).status).toBe("cancelled")
    expect(await queue.claimNextPrompt(chat.id)).toBeNull()
    expect(await prisma.queuedPrompt.count({ where: { chatId: chat.id } })).toBe(1)
  })

  it("is idempotent when concurrent sends and removals share one request identity", async () => {
    const chat = await prisma.chat.create({ data: { userId, repo: "__new__", status: "ready" } })
    const prompt = input(`concurrent-${run}`)
    await Promise.all([
      queue.enqueuePrompt(chat.id, prompt),
      queue.cancelQueuedPrompt(chat.id, { clientId: prompt.clientId }),
      queue.enqueuePrompt(chat.id, prompt),
    ])
    expect(await queue.cancelQueuedPrompt(chat.id, { clientId: prompt.clientId })).toBe(true)
    expect((await prisma.queuedPrompt.findMany({ where: { chatId: chat.id } })).map((row) => row.status)).toEqual(["cancelled"])
    expect(await queue.claimNextPrompt(chat.id)).toBeNull()
  })

  it("does not report successful removal once a worker has claimed the prompt", async () => {
    const chat = await prisma.chat.create({ data: { userId, repo: "__new__", status: "ready" } })
    const prompt = input(`claimed-${run}`)
    await queue.enqueuePrompt(chat.id, prompt)
    expect(await queue.claimNextPrompt(chat.id)).not.toBeNull()
    expect(await queue.cancelQueuedPrompt(chat.id, { clientId: prompt.clientId })).toBe(false)
  })
})
