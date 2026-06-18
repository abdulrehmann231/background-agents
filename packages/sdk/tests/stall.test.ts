import { describe, it, expect } from "vitest"
import {
  isTurnStalled,
  resolveStallTimeoutMs,
  DEFAULT_STALL_TIMEOUT_MS,
} from "../src/background/stall"

describe("isTurnStalled", () => {
  const timeoutMs = 240_000

  it("does not flag a turn that is producing output (recent activity)", () => {
    expect(
      isTurnStalled({ running: true, msSinceLastActivity: 1_000, timeoutMs })
    ).toBe(false)
  })

  it("flags a running turn that has been silent past the timeout", () => {
    // This is the OpenCode quota-hang case: the process is alive ("running")
    // but has emitted nothing for longer than the threshold.
    expect(
      isTurnStalled({ running: true, msSinceLastActivity: 240_001, timeoutMs })
    ).toBe(true)
  })

  it("trips exactly at the threshold", () => {
    expect(
      isTurnStalled({ running: true, msSinceLastActivity: 240_000, timeoutMs })
    ).toBe(true)
  })

  it("never flags a turn that already ended, however long it's been quiet", () => {
    // Completed/errored turns are handled by the normal terminal path; only a
    // still-"running" turn can stall.
    expect(
      isTurnStalled({ running: false, msSinceLastActivity: 10_000_000, timeoutMs })
    ).toBe(false)
  })

  it("is disabled when timeoutMs <= 0", () => {
    expect(
      isTurnStalled({ running: true, msSinceLastActivity: 10_000_000, timeoutMs: 0 })
    ).toBe(false)
    expect(
      isTurnStalled({ running: true, msSinceLastActivity: 10_000_000, timeoutMs: -1 })
    ).toBe(false)
  })

  it("uses a responsive default (2 min) so a wedged turn surfaces quickly", () => {
    expect(DEFAULT_STALL_TIMEOUT_MS).toBe(120_000)
  })

  it("defaults to DEFAULT_STALL_TIMEOUT_MS when no timeout is given", () => {
    expect(
      isTurnStalled({
        running: true,
        msSinceLastActivity: DEFAULT_STALL_TIMEOUT_MS - 1,
      })
    ).toBe(false)
    expect(
      isTurnStalled({
        running: true,
        msSinceLastActivity: DEFAULT_STALL_TIMEOUT_MS,
      })
    ).toBe(true)
  })
})

describe("resolveStallTimeoutMs", () => {
  it("uses the default when unset or blank", () => {
    expect(resolveStallTimeoutMs(undefined)).toBe(DEFAULT_STALL_TIMEOUT_MS)
    expect(resolveStallTimeoutMs("")).toBe(DEFAULT_STALL_TIMEOUT_MS)
    expect(resolveStallTimeoutMs("   ")).toBe(DEFAULT_STALL_TIMEOUT_MS)
  })

  it("parses a numeric override", () => {
    expect(resolveStallTimeoutMs("60000")).toBe(60_000)
  })

  it("allows disabling via 0", () => {
    expect(resolveStallTimeoutMs("0")).toBe(0)
  })

  it("falls back to the default on garbage", () => {
    expect(resolveStallTimeoutMs("not-a-number")).toBe(DEFAULT_STALL_TIMEOUT_MS)
  })
})
