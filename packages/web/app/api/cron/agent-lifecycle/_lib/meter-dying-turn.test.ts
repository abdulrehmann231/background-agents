/**
 * Tests for metering a turn the cron is about to tear down.
 *
 * The bug these cover was one of ordering, not arithmetic: markChatError and
 * failScheduledRun cleared `backgroundSessionId` — and, for a scheduled run,
 * deleted the sandbox — before anything had read the turn's usage. Both are the
 * only handles metering has, so a crashed or timed-out turn was not merely
 * unbilled but unrecoverable. 262 of 548 agent-stopped events in production
 * recorded nothing at all.
 *
 * So what is asserted here is sequence: the meter must run, and it must run
 * first. A test that only checked "usage was recorded" would still pass against
 * the broken code if the teardown happened to be slower.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

/** Every call the code under test makes, in the order it made them. */
let calls: string[] = []

const meterAssistantTurn = vi.fn(async () => {
  calls.push("meter")
  return 1
})

vi.mock("@/lib/server/token-metering", () => ({
  meterAssistantTurn: (...args: unknown[]) => meterAssistantTurn(...(args as [])),
}))

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    chat: {
      update: vi.fn(async () => {
        calls.push("clear-session")
        return {}
      }),
    },
    message: {
      create: vi.fn(async () => {
        calls.push("error-message")
        return {}
      }),
      findFirst: vi.fn(async () => ({ id: "msg_1", metadata: null })),
    },
  },
}))

import { meterDyingTurn } from "./meter-dying-turn"
import { markChatError } from "./interactive"

/** A sandbox handle; the metering call is mocked, so it is never used. */
const sandbox = {}
const daytona = { get: vi.fn(async () => sandbox) } as never

const dyingChat = {
  id: "chat_1",
  userId: "user_1",
  agent: "opencode",
  sandboxId: "sandbox_1",
  backgroundSessionId: "ses_1",
}

beforeEach(() => {
  calls = []
  meterAssistantTurn.mockClear()
})

describe("meterDyingTurn", () => {
  it("meters the turn when the sandbox and session are still around", async () => {
    const rows = await meterDyingTurn({ ...dyingChat, chatId: "chat_1", daytona })
    expect(rows).toBe(1)
    expect(meterAssistantTurn).toHaveBeenCalledTimes(1)
  })

  it.each([
    ["no sandbox", { sandboxId: null }],
    ["no session id", { backgroundSessionId: null }],
    ["no daytona client", { daytona: undefined }],
  ])("does nothing and does not throw when there is %s", async (_label, over) => {
    const rows = await meterDyingTurn({
      ...dyingChat,
      chatId: "chat_1",
      daytona,
      ...over,
    })
    expect(rows).toBe(0)
    expect(meterAssistantTurn).not.toHaveBeenCalled()
  })

  it("swallows a metering failure — a bad turn must not get worse", async () => {
    meterAssistantTurn.mockRejectedValueOnce(new Error("tokscale exploded"))
    await expect(
      meterDyingTurn({ ...dyingChat, chatId: "chat_1", daytona })
    ).resolves.toBe(0)
  })
})

describe("markChatError", () => {
  it("meters BEFORE clearing the session id", async () => {
    await markChatError(dyingChat, "Run exceeded 25 minute limit", daytona)
    // The whole bug in one assertion: reverse these two and the turn's usage is
    // gone, because the cursor it would be diffed against no longer exists.
    expect(calls).toEqual(["meter", "clear-session", "error-message"])
  })

  it("still releases the chat when metering throws", async () => {
    meterAssistantTurn.mockRejectedValueOnce(new Error("tokscale exploded"))
    await markChatError(dyingChat, "Agent stopped", daytona)
    // Metering is best-effort. A chat stranded as "running" is a worse failure
    // than an unbilled turn, so the teardown must survive it.
    expect(calls).toEqual(["clear-session", "error-message"])
  })

  it("still releases the chat when there is nothing to meter", async () => {
    await markChatError({ ...dyingChat, sandboxId: null }, "Agent stopped", daytona)
    expect(calls).toEqual(["clear-session", "error-message"])
    expect(meterAssistantTurn).not.toHaveBeenCalled()
  })
})
