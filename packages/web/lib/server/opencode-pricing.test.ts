/**
 * Unit tests for first-party OpenCode Go rates.
 */
import { describe, it, expect } from "vitest"

import { normalizeOpenCodeModel, openCodeKnownRatesFor } from "./opencode-pricing"

describe("normalizeOpenCodeModel", () => {
  it("accepts both the routed and the recorded form of an id", () => {
    expect(normalizeOpenCodeModel("opencode-go/glm-5.2")).toBe("glm-5.2")
    expect(normalizeOpenCodeModel("glm-5.2")).toBe("glm-5.2")
    expect(normalizeOpenCodeModel("OpenCode-Go/GLM-5.2")).toBe("glm-5.2")
  })

  it("declines models these rates do not describe", () => {
    // Zen pay-as-you-go, billed at different rates than OpenCode Go.
    expect(normalizeOpenCodeModel("opencode/glm-5.2")).toBeNull()
    expect(normalizeOpenCodeModel("mimo-v2.5-free")).toBeNull()
    expect(normalizeOpenCodeModel("some-model-we-do-not-price")).toBeNull()
    expect(normalizeOpenCodeModel(null)).toBeNull()
  })
})

describe("openCodeKnownRatesFor", () => {
  it("returns the model's own cache-read rate, not a multiple of input", () => {
    // 0.8% of input on MiMo against 20% on Kimi — the reason each model carries
    // its own rate rather than deriving one the way Claude's table does.
    expect(openCodeKnownRatesFor("mimo-v2.5-pro")).toEqual({
      input: 0.43,
      cacheRead: 0.0037,
      cacheWrite: 0,
    })
    expect(openCodeKnownRatesFor("opencode-go/kimi-k2.6")).toEqual({
      input: 0.95,
      cacheRead: 0.16,
      cacheWrite: 0,
    })
  })

  it("returns null for a model with no solved rates", () => {
    expect(openCodeKnownRatesFor("qwen3.7-max")).toBeNull()
  })
})
