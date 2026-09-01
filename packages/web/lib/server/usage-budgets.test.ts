/**
 * Unit tests for shared-pool budget resolution.
 */
import { describe, it, expect } from "vitest"

import {
  BUDGET_BOOSTS,
  getProviderBudget,
  isFreeModel,
  PRO_BUDGET_MULTIPLIER,
} from "./usage-budgets"

describe("getProviderBudget", () => {
  it("meters the Claude pool in cost, not tokens", () => {
    // The pool spans a 10× price-per-token spread (Haiku → Fable), so the
    // budget has to be denominated in money for the tiers to mean anything.
    expect(getProviderBudget("claude")?.unit).toBe("cost")
  })

  it("scales the free budget by the Pro multiplier", () => {
    const free = getProviderBudget("claude", "free")!
    const pro = getProviderBudget("claude", "pro")!
    expect(pro.unit).toBe(free.unit)
    expect(pro.limit).toBeCloseTo(free.limit * PRO_BUDGET_MULTIPLIER, 10)
  })

  it("scales both plans by a live boost, and drops it once it expires", () => {
    const boost = BUDGET_BOOSTS.claude
    if (!boost) return // no boost configured — nothing to assert

    const during = new Date(boost.until.getTime() - 1000)
    const after = boost.until

    const baseFree = getProviderBudget("claude", "free", after)!
    expect(getProviderBudget("claude", "free", during)!.limit).toBeCloseTo(
      baseFree.limit * boost.multiplier,
      10
    )
    expect(getProviderBudget("claude", "pro", during)!.limit).toBeCloseTo(
      baseFree.limit * boost.multiplier * PRO_BUDGET_MULTIPLIER,
      10
    )
    expect(getProviderBudget("claude", "pro", after)!.limit).toBeCloseTo(
      baseFree.limit * PRO_BUDGET_MULTIPLIER,
      10
    )
  })

  it("leaves the unlimited plan uncapped while a boost is live", () => {
    const boost = BUDGET_BOOSTS.claude
    if (!boost) return
    const during = new Date(boost.until.getTime() - 1000)
    expect(getProviderBudget("claude", "unlimited", during)).toBeNull()
  })

  it("leaves the unlimited plan uncapped", () => {
    expect(getProviderBudget("claude", "unlimited")).toBeNull()
  })

  it("returns null for providers with no shared-pool budget", () => {
    expect(getProviderBudget("codex")).toBeNull()
  })
})

describe("isFreeModel", () => {
  it("catches the explicit set and the -free/:free conventions", () => {
    expect(isFreeModel("big-pickle")).toBe(true)
    expect(isFreeModel("nemotron-3-ultra-free")).toBe(true)
    expect(isFreeModel("some-new-model:free")).toBe(true)
    expect(isFreeModel("claude-opus-5")).toBe(false)
    expect(isFreeModel(null)).toBe(false)
  })
})
