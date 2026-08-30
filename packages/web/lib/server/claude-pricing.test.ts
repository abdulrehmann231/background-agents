/**
 * Unit tests for first-party Claude pricing.
 */
import { describe, it, expect } from "vitest"

import { normalizeClaudeModel, priceClaudeTurn } from "./claude-pricing"

const NO_TOKENS = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  reasoningTokens: 0,
}

describe("normalizeClaudeModel", () => {
  it("normalizes current ids, with and without a release date", () => {
    expect(normalizeClaudeModel("claude-opus-4-5")).toBe("opus-4.5")
    expect(normalizeClaudeModel("claude-opus-4-5-20251101")).toBe("opus-4.5")
    expect(normalizeClaudeModel("claude-sonnet-4-6")).toBe("sonnet-4.6")
    expect(normalizeClaudeModel("claude-haiku-4-5-20251001")).toBe("haiku-4.5")
  })

  it("does not read a release date as the minor version", () => {
    expect(normalizeClaudeModel("claude-opus-5")).toBe("opus-5")
    expect(normalizeClaudeModel("claude-opus-5-20260101")).toBe("opus-5")
    expect(normalizeClaudeModel("claude-sonnet-5-20260315")).toBe("sonnet-5")
  })

  it("accepts dotted versions, vendor prefixes and suffixes", () => {
    expect(normalizeClaudeModel("claude-opus-4.8")).toBe("opus-4.8")
    expect(normalizeClaudeModel("anthropic/claude-sonnet-5")).toBe("sonnet-5")
    expect(normalizeClaudeModel("us.anthropic.claude-opus-4-5-20251101-v1:0")).toBe(
      "opus-4.5"
    )
    expect(normalizeClaudeModel("claude-opus-4-6-thinking")).toBe("opus-4.6")
    expect(normalizeClaudeModel("CLAUDE-OPUS-5")).toBe("opus-5")
  })

  it("handles the legacy version-first ordering", () => {
    expect(normalizeClaudeModel("claude-3-5-haiku-20241022")).toBe("haiku-3.5")
  })

  it("returns null for non-Claude and empty ids", () => {
    expect(normalizeClaudeModel("gpt-5.3")).toBeNull()
    expect(normalizeClaudeModel("glm-5.2")).toBeNull()
    expect(normalizeClaudeModel(null)).toBeNull()
    expect(normalizeClaudeModel("")).toBeNull()
  })
})

describe("priceClaudeTurn", () => {
  it("prices base input and output at the published rates", () => {
    // Opus 5: $5/MTok in, $25/MTok out.
    const cost = priceClaudeTurn("claude-opus-5", {
      ...NO_TOKENS,
      inputTokens: 50_000,
      outputTokens: 15_000,
    })
    // 50k × $5/M = $0.25, 15k × $25/M = $0.375 — the worked example from
    // Anthropic's pricing page, minus its session-runtime line.
    expect(cost).toBeCloseTo(0.625, 10)
  })

  it("prices cache reads at 0.1x and cache writes at 1.25x base input", () => {
    const cost = priceClaudeTurn("claude-opus-5", {
      ...NO_TOKENS,
      cacheReadTokens: 40_000,
      cacheWriteTokens: 8_000,
    })
    // 40k × $5 × 0.1/M = $0.02; 8k × $5 × 1.25/M = $0.05
    expect(cost).toBeCloseTo(0.07, 10)
  })

  it("bills reasoning tokens at the output rate", () => {
    const cost = priceClaudeTurn("claude-sonnet-5", {
      ...NO_TOKENS,
      reasoningTokens: 10_000,
    })
    // Sonnet 5 output is $10/MTok.
    expect(cost).toBeCloseTo(0.1, 10)
  })

  it("scales with the model tier", () => {
    const tokens = { ...NO_TOKENS, inputTokens: 1_000_000, outputTokens: 1_000_000 }
    expect(priceClaudeTurn("claude-haiku-4-5", tokens)).toBeCloseTo(6, 10)
    expect(priceClaudeTurn("claude-sonnet-5", tokens)).toBeCloseTo(12, 10)
    expect(priceClaudeTurn("claude-sonnet-4-6", tokens)).toBeCloseTo(18, 10)
    expect(priceClaudeTurn("claude-opus-5", tokens)).toBeCloseTo(30, 10)
    expect(priceClaudeTurn("claude-fable-5", tokens)).toBeCloseTo(60, 10)
    expect(priceClaudeTurn("claude-opus-4-1", tokens)).toBeCloseTo(90, 10)
  })

  it("returns 0 for a known model with no tokens", () => {
    expect(priceClaudeTurn("claude-opus-5", NO_TOKENS)).toBe(0)
  })

  it("returns null for models it has no rates for", () => {
    expect(priceClaudeTurn("gpt-5.3", { ...NO_TOKENS, outputTokens: 1000 })).toBeNull()
    // A Claude family/version that isn't in the table.
    expect(
      priceClaudeTurn("claude-3-7-sonnet-20250219", { ...NO_TOKENS, outputTokens: 1000 })
    ).toBeNull()
    expect(priceClaudeTurn(null, NO_TOKENS)).toBeNull()
  })
})
