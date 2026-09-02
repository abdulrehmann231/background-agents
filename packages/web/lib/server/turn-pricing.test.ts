/**
 * Unit tests for the two decisions that keep a metered turn from costing $0.
 *
 * Both exist because the daily balance is now the only cap: an unpriceable turn
 * is not a rounding error, it is a free route around it.
 */
import { describe, it, expect } from "vitest"

import { resolveTurnModel, floorCostUsd } from "./turn-pricing"

describe("resolveTurnModel", () => {
  it("swaps Droid's BYOK placeholder for the model the run actually used", () => {
    // Droid runs a BYOK model through `-m custom:byok-0` and writes "byok-0"
    // as the model id, which no price table resolves. Before this, a Gemini
    // model under Droid on the shared key metered at $0.
    expect(resolveTurnModel("byok-0", "gemini-3.5-flash-lite")).toBe(
      "gemini-3.5-flash-lite"
    )
    expect(resolveTurnModel("custom:byok-0", "gemini-2.5-flash")).toBe(
      "gemini-2.5-flash"
    )
  })

  it("swaps Claude Code's synthetic placeholder too", () => {
    expect(resolveTurnModel("<synthetic>", "claude-opus-4-8")).toBe("claude-opus-4-8")
  })

  it("matches placeholders regardless of case", () => {
    expect(resolveTurnModel("BYOK-0", "gemini-2.5-flash")).toBe("gemini-2.5-flash")
  })

  it("never overrides a real model id", () => {
    // The reported id is the authority whenever it names something priceable —
    // the chat's model can drift from what the CLI actually ran.
    expect(resolveTurnModel("claude-fable-5", "claude-sonnet-5")).toBe("claude-fable-5")
    expect(resolveTurnModel("mimo-v2.5-pro", "glm-5.2")).toBe("mimo-v2.5-pro")
  })

  it("keeps the placeholder when no run model is known", () => {
    // Older messages carry no model in their usage metadata. The row is still
    // written — the floor rate is what stops it being free.
    expect(resolveTurnModel("byok-0", null)).toBe("byok-0")
    expect(resolveTurnModel("byok-0", undefined)).toBe("byok-0")
  })

  it("returns null for a turn with no model at all", () => {
    expect(resolveTurnModel(null, null)).toBeNull()
    expect(resolveTurnModel(undefined, "gemini-2.5-flash")).toBeNull()
  })
})

describe("floorCostUsd", () => {
  it("is never zero for a turn that consumed tokens", () => {
    // The whole point: $0 on a shared pool is uncapped usage.
    expect(floorCostUsd(1)).toBeGreaterThan(0)
    expect(floorCostUsd(6_807_223)).toBeGreaterThan(0)
  })

  it("is cheap enough not to punish a user for our gap", () => {
    // Priced off the cheapest paid model in use, so ~7M tokens — the observed
    // byok-0 volume — costs under a tenth of a dollar against a $5 balance.
    expect(floorCostUsd(6_807_223)).toBeLessThan(0.1)
  })

  it("scales linearly with tokens", () => {
    expect(floorCostUsd(2_000_000)).toBeCloseTo(floorCostUsd(1_000_000) * 2, 12)
  })

  it("is zero for an empty turn", () => {
    expect(floorCostUsd(0)).toBe(0)
  })
})
