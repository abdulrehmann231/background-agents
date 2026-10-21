import { describe, expect, it } from "vitest"
import { mergeMessages } from "./merge-messages"
import type { Message } from "./types"

const reply = (overrides: Partial<Message> = {}): Message => ({
  id: "reply", role: "assistant", content: "partial output", timestamp: 2, ...overrides,
})
const failure = (executionStopped = true) => ({
  state: "error", executionStopped, assistantMessageId: "reply", backgroundSessionId: "run",
  reason: "ProviderModelNotFoundError: model is not available",
})

describe("message history and finalization reconciliation", () => {
  it.each(["", "partial output", "partial output with more content"])(
    "receives failure metadata independently of incoming output length: %j", (content) => {
      const existing = reply()
      const incoming = reply({ content, metadata: { turnFinalization: failure() } })
      const [merged] = mergeMessages([existing], [incoming])
      expect(merged.content).toBe(content.length > existing.content.length ? content : existing.content)
      expect(merged.metadata?.turnFinalization).toEqual(failure())
    },
  )

  it.each([undefined, failure(false)])("never loses a confirmed outcome to a larger stale history copy: %j", (marker) => {
    const existing = reply({ metadata: { turnFinalization: failure() } })
    const incoming = reply({ content: "a longer delayed output snapshot", timestamp: 3,
      metadata: marker ? { turnFinalization: marker } : undefined })
    expect(mergeMessages([existing], [incoming])[0].metadata?.turnFinalization).toEqual(failure())
  })

  it("promotes a cancellation decision only when the matching execution is confirmed stopped", () => {
    const pending = reply({ metadata: { turnFinalization: failure(false) } })
    const confirmed = reply({ metadata: { turnFinalization: failure() } })
    expect(mergeMessages([pending], [confirmed])[0].metadata?.turnFinalization?.executionStopped).toBe(true)
    expect(mergeMessages([confirmed], [pending])[0].metadata?.turnFinalization?.executionStopped).toBe(true)
  })

  it("does not replace the recorded decision with another reason from an out-of-order copy", () => {
    const existing = reply({ metadata: { turnFinalization: failure() } })
    const incoming = reply({ timestamp: 3, metadata: { turnFinalization: { ...failure(), reason: "stale reason" } } })
    expect(mergeMessages([existing], [incoming])[0].metadata?.turnFinalization).toEqual(failure())
  })

  it.each(["assistantMessageId", "backgroundSessionId"])("does not join another execution's outcome by %s", (key) => {
    const existing = reply({ metadata: { turnFinalization: failure(false) } })
    const incoming = reply({ timestamp: 3, metadata: { turnFinalization: { ...failure(), [key]: "other" } } })
    expect(mergeMessages([existing], [incoming])[0].metadata?.turnFinalization).toEqual(failure(false))
  })

  it("keeps unrelated metadata when adding the outcome to streamed content", () => {
    const existing = reply({ metadata: { prNumber: 455 } })
    const incoming = reply({ content: "", metadata: { turnFinalization: failure() } })
    expect(mergeMessages([existing], [incoming])[0].metadata).toEqual({ prNumber: 455, turnFinalization: failure() })
  })

  it("does not move a previous turn's error onto the next assistant", () => {
    const next = reply({ id: "next-reply", timestamp: 4, content: "next answer" })
    const merged = mergeMessages([reply(), next], [reply({ metadata: { turnFinalization: failure() } })])
    expect(merged[0].metadata?.turnFinalization).toEqual(failure())
    expect(merged[1]).toEqual(next)
  })

  it("preserves streamed output against an older shorter read", () => {
    const existing = reply({ content: "the complete streamed answer" })
    expect(mergeMessages([existing], [reply()])[0]).toEqual(existing)
  })
})
