/**
 * Unit tests for the diff cursor's keying rules.
 *
 * These exist because the bug they cover was invisible by inspection: the
 * lookup key and the stored key were computed a few lines apart and looked
 * interchangeable. They are not, and the cost of getting it wrong is a turn
 * charged the session's entire history instead of its delta.
 */
import { describe, it, expect } from "vitest"

import {
  cursorForModel,
  sumCumulatives,
  ZERO_CUMULATIVE,
  type SessionCumulative,
} from "./usage-cursor"

/** A cursor entry with every component set to `n`, for terse assertions. */
const cume = (n: number): SessionCumulative => ({
  inputTokens: n,
  outputTokens: n,
  cacheReadTokens: n,
  cacheWriteTokens: n,
  reasoningTokens: n,
  totalTokens: n,
  costUsd: n,
})

describe("sumCumulatives", () => {
  it("returns zero for no parts", () => {
    expect(sumCumulatives()).toEqual(ZERO_CUMULATIVE)
  })

  it("skips absent parts rather than treating them as zero-valued objects", () => {
    expect(sumCumulatives(undefined, cume(3), undefined)).toEqual(cume(3))
  })

  it("adds every component", () => {
    expect(sumCumulatives(cume(2), cume(5))).toEqual(cume(7))
  })

  it("does not mutate its inputs or the shared zero", () => {
    const a = cume(1)
    sumCumulatives(a, cume(4))
    expect(a).toEqual(cume(1))
    expect(ZERO_CUMULATIVE).toEqual(cume(0))
  })
})

describe("cursorForModel", () => {
  it("looks up the id the row is STORED under, not the one tokscale reported", () => {
    // The regression: Droid reports "byok-0", we store "gemini-3-flash".
    // Keying on the reported id found nothing, so the turn was charged the
    // whole session cumulative instead of its delta.
    const prior = new Map([["gemini-3-flash", cume(500)]])
    expect(cursorForModel(prior, "byok-0", "gemini-3-flash")).toEqual(cume(500))
  })

  it("sums both ids for a session that straddles the fix", () => {
    // Rows written before the fix sit under the placeholder; rows written
    // after sit under the resolved id. Taking either half alone would
    // understate the cursor and overcharge the turn by the other half.
    const prior = new Map([
      ["byok-0", cume(100)],
      ["gemini-3-flash", cume(400)],
    ])
    expect(cursorForModel(prior, "byok-0", "gemini-3-flash")).toEqual(cume(500))
  })

  it("does not double-count when the id was never rewritten", () => {
    const prior = new Map([["claude-fable-5", cume(700)]])
    expect(cursorForModel(prior, "claude-fable-5", "claude-fable-5")).toEqual(
      cume(700)
    )
  })

  it("treats a null model as the empty-string key both modules agree on", () => {
    const prior = new Map([["", cume(9)]])
    expect(cursorForModel(prior, null, null)).toEqual(cume(9))
  })

  it("returns zero on a genuine first capture", () => {
    expect(cursorForModel(new Map(), "claude-fable-5", "claude-fable-5")).toEqual(
      ZERO_CUMULATIVE
    )
  })
})
