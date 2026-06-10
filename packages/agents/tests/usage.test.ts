/**
 * Usage normalization tests - pure transformations from tokscale JSON output
 * to normalized cumulative usage and per-turn deltas. No mocks, no I/O.
 */
import { describe, it, expect } from "vitest"
import {
  normalizeTokscaleUsage,
  diffUsage,
  extractRows,
  usageToEvent,
  providerToTokscaleClient,
  type CumulativeUsage,
} from "../src/background/usage.js"

describe("providerToTokscaleClient", () => {
  it("maps known providers to client ids", () => {
    expect(providerToTokscaleClient("claude")).toBe("claude")
    expect(providerToTokscaleClient("codex")).toBe("codex")
    expect(providerToTokscaleClient("opencode")).toBe("opencode")
  })

  it("returns null for unsupported providers", () => {
    expect(providerToTokscaleClient("eliza")).toBeNull()
    expect(providerToTokscaleClient("totally-unknown")).toBeNull()
  })
})

describe("extractRows", () => {
  it("handles a bare array", () => {
    expect(extractRows([{ totalTokens: 1 }, { totalTokens: 2 }])).toHaveLength(2)
  })

  it("unwraps a rows/data wrapper object", () => {
    expect(extractRows({ rows: [{ totalTokens: 1 }] })).toHaveLength(1)
    expect(extractRows({ data: [{ tokens: 1 }] })).toHaveLength(1)
  })

  it("treats a single token-bearing object as one row", () => {
    expect(extractRows({ inputTokens: 5, outputTokens: 1 })).toHaveLength(1)
  })

  it("returns empty for unrecognized shapes", () => {
    expect(extractRows({ foo: "bar" })).toHaveLength(0)
    expect(extractRows(null)).toHaveLength(0)
    expect(extractRows("nope")).toHaveLength(0)
  })
})

describe("normalizeTokscaleUsage", () => {
  it("parses camelCase token + cost fields", () => {
    const raw = JSON.stringify([
      {
        sessionId: "s1",
        model: "claude-sonnet-4",
        inputTokens: 10,
        outputTokens: 4,
        cacheReadTokens: 100,
        cacheWriteTokens: 20,
        totalTokens: 134,
        cost: 0.0123,
      },
    ])
    const u = normalizeTokscaleUsage(raw, "s1")
    expect(u).toMatchObject({
      inputTokens: 10,
      outputTokens: 4,
      cacheReadTokens: 100,
      cacheWriteTokens: 20,
      totalTokens: 134,
      costUSD: 0.0123,
      hasCost: true,
      model: "claude-sonnet-4",
    })
  })

  it("parses snake_case aliases and derives total when absent", () => {
    const raw = JSON.stringify([
      { input_tokens: 6, output_tokens: 3, cache_read_input_tokens: 1 },
    ])
    const u = normalizeTokscaleUsage(raw)
    expect(u.inputTokens).toBe(6)
    expect(u.outputTokens).toBe(3)
    expect(u.cacheReadTokens).toBe(1)
    expect(u.totalTokens).toBe(10) // derived: 6 + 3 + 1 + 0
    expect(u.hasCost).toBe(false)
  })

  it("sums multiple rows for the same session (multi-model)", () => {
    const raw = JSON.stringify([
      { sessionId: "s1", model: "a", totalTokens: 100, cost: 0.01 },
      { sessionId: "s1", model: "b", totalTokens: 50, cost: 0.02 },
    ])
    const u = normalizeTokscaleUsage(raw, "s1")
    expect(u.totalTokens).toBe(150)
    expect(u.costUSD).toBeCloseTo(0.03)
    expect(u.model).toBeUndefined() // mixed models -> no single label
  })

  it("filters to the matching session when present", () => {
    const raw = JSON.stringify([
      { sessionId: "s1", totalTokens: 100 },
      { sessionId: "s2", totalTokens: 999 },
    ])
    expect(normalizeTokscaleUsage(raw, "s1").totalTokens).toBe(100)
  })

  it("sums all rows when the session id is absent from the data", () => {
    const raw = JSON.stringify([
      { sessionId: "x", totalTokens: 100 },
      { sessionId: "y", totalTokens: 50 },
    ])
    // requested session not present -> fall back to summing all
    expect(normalizeTokscaleUsage(raw, "missing").totalTokens).toBe(150)
  })

  it("returns zeroed usage for invalid or empty JSON", () => {
    expect(normalizeTokscaleUsage("not json").totalTokens).toBe(0)
    expect(normalizeTokscaleUsage("[]").totalTokens).toBe(0)
  })
})

describe("diffUsage", () => {
  const cur: CumulativeUsage = {
    inputTokens: 30,
    outputTokens: 12,
    cacheReadTokens: 300,
    cacheWriteTokens: 40,
    totalTokens: 382,
    costUSD: 0.05,
    hasCost: true,
    model: "m",
  }

  it("subtracts the baseline to yield one turn", () => {
    const base: CumulativeUsage = {
      inputTokens: 20,
      outputTokens: 8,
      cacheReadTokens: 200,
      cacheWriteTokens: 20,
      totalTokens: 248,
      costUSD: 0.03,
      hasCost: true,
    }
    const d = diffUsage(cur, base)
    expect(d.inputTokens).toBe(10)
    expect(d.outputTokens).toBe(4)
    expect(d.cacheReadTokens).toBe(100)
    expect(d.cacheWriteTokens).toBe(20)
    expect(d.totalTokens).toBe(134)
    expect(d.costUSD).toBeCloseTo(0.02)
  })

  it("treats no baseline as the full first-turn usage", () => {
    expect(diffUsage(cur).totalTokens).toBe(382)
  })

  it("clamps negatives to zero", () => {
    const biggerBase: CumulativeUsage = { ...cur, totalTokens: 999, costUSD: 9 }
    const d = diffUsage(cur, biggerBase)
    expect(d.totalTokens).toBe(0)
    expect(d.costUSD).toBe(0)
  })
})

describe("usageToEvent", () => {
  it("maps a delta into a wire event with cost", () => {
    const ev = usageToEvent("claude", {
      inputTokens: 10,
      outputTokens: 4,
      cacheReadTokens: 1,
      cacheWriteTokens: 2,
      totalTokens: 17,
      costUSD: 0.01,
      hasCost: true,
      model: "claude-x",
    })
    expect(ev).toEqual({
      type: "usage",
      provider: "claude",
      model: "claude-x",
      inputTokens: 10,
      outputTokens: 4,
      cacheReadTokens: 1,
      cacheWriteTokens: 2,
      totalTokens: 17,
      costUSD: 0.01,
      source: "tokscale",
    })
  })

  it("omits cost when not priceable", () => {
    const ev = usageToEvent("copilot", {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
      costUSD: 0,
      hasCost: false,
    })
    expect(ev.costUSD).toBeUndefined()
  })
})
