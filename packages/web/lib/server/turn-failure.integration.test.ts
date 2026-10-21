import { afterAll, beforeAll, expect, it } from "vitest"
import { createTestUser, databaseDescribe, deleteTestUser } from "./db-test-helpers"

type Database = typeof import("@/lib/db/prisma").prisma
type Failures = typeof import("./turn-failure")
let prisma: Database
let recordTurnFailure: Failures["recordTurnFailure"]
let readTurnFailure: Failures["readTurnFailure"]
let userId: string

databaseDescribe("persisted turn failure decisions", () => {
  beforeAll(async () => {
    ;({ prisma, userId } = await createTestUser("failure-outcome"))
    ;({ recordTurnFailure, readTurnFailure } = await import("./turn-failure"))
  })
  afterAll(() => deleteTestUser(prisma, userId))

  it("keeps the first failure decision and never reverts a confirmed stop across retrying observers", async () => {
    const sessionId = crypto.randomUUID()
    const assistantMessageId = crypto.randomUUID()
    const claimId = crypto.randomUUID()
    const chat = await prisma.chat.create({ data: { userId, repo: "__new__", status: "running",
      backgroundSessionId: sessionId, activeAssistantMessageId: assistantMessageId, finalizationClaimId: claimId } })
    await prisma.message.create({ data: { id: assistantMessageId, chatId: chat.id, role: "assistant", content: "", timestamp: 1n } })
    const turn = { chatId: chat.id, backgroundSessionId: sessionId, assistantMessageId }
    expect(await recordTurnFailure(turn, claimId, "ProviderModelNotFoundError: Model unavailable", false)).toBe(true)
    await Promise.all([
      recordTurnFailure(turn, claimId, "same observer retry", true),
      recordTurnFailure(turn, claimId, "delayed pre-stop write", false),
    ])
    expect(await readTurnFailure(turn)).toMatchObject({ executionStopped: true,
      reason: "ProviderModelNotFoundError: Model unavailable" })
    expect(await recordTurnFailure(turn, "stale-claim", "another error", false)).toBe(false)
    expect(await readTurnFailure(turn)).toMatchObject({ executionStopped: true,
      reason: "ProviderModelNotFoundError: Model unavailable" })
  })
})
