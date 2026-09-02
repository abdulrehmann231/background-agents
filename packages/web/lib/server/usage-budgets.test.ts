/**
 * Unit tests for the daily balance.
 */
import { describe, it, expect } from "vitest"

import {
  getDailyBalance,
  isFreeModel,
  BALANCE_POOL_PROVIDERS,
  PRO_BUDGET_MULTIPLIER,
} from "./usage-budgets"

describe("getDailyBalance", () => {
  it("gives free users a finite daily balance", () => {
    const free = getDailyBalance("free")
    expect(free).toBeGreaterThan(0)
    expect(Number.isFinite(free!)).toBe(true)
  })

  it("scales the free balance by the Pro multiplier", () => {
    expect(getDailyBalance("pro")).toBeCloseTo(
      getDailyBalance("free")! * PRO_BUDGET_MULTIPLIER,
      10
    )
  })

  it("leaves the unlimited plan uncapped", () => {
    expect(getDailyBalance("unlimited")).toBeNull()
  })

  it("defaults to the free balance when no plan is given", () => {
    expect(getDailyBalance()).toBe(getDailyBalance("free"))
  })
})

describe("BALANCE_POOL_PROVIDERS", () => {
  it("covers every shared pool, so the balance can't be routed around", () => {
    // A provider missing here is an unmetered path: the user would keep working
    // on it with nothing left.
    expect([...BALANCE_POOL_PROVIDERS].sort()).toEqual([
      "claude",
      "gemini",
      "opencode",
    ])
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
