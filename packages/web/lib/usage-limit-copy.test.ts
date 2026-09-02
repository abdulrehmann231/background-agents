import { describe, expect, it } from "vitest"
import {
  formatUsageLimitMessage,
  getLimitUpgradeCopy,
} from "./usage-limit-copy"

describe("formatUsageLimitMessage", () => {
  it("describes Pro as a bigger balance for free users, and names the free-model escape", () => {
    expect(formatUsageLimitMessage({ plan: "free", limit: 5 })).toBe(
      "Daily limit reached ($5.00). " +
      "Upgrade to Pro for twice the daily balance, upgrade to Unlimited for uncapped usage, " +
      "add your own API key, or switch to a free model."
    )
  })

  it("only offers Unlimited, BYOK or free models after a Pro user runs out", () => {
    expect(formatUsageLimitMessage({ plan: "pro", limit: 10 })).toBe(
      "Daily limit reached ($10.00). " +
      "Upgrade to Unlimited for uncapped usage, add your own API key, " +
      "or switch to a free model."
    )
  })

  it("does not promise a plan upgrade to Unlimited users", () => {
    expect(formatUsageLimitMessage({ plan: "unlimited", limit: 5 })).toBe(
      "Daily limit reached ($5.00). Add your own API key to continue."
    )
  })

  it("names no provider — the balance is pooled across all three", () => {
    const msg = formatUsageLimitMessage({ plan: "free", limit: 5 })
    for (const provider of ["Claude", "Gemini", "OpenCode"]) {
      expect(msg).not.toContain(provider)
    }
  })

  it("renders the allowance as money", () => {
    expect(formatUsageLimitMessage({ plan: "free", limit: 2.5 })).toContain("($2.50)")
  })
})

describe("getLimitUpgradeCopy", () => {
  it("offers Pro with accurate benefits to free users", () => {
    expect(getLimitUpgradeCopy("free")).toEqual({
      targetPlan: "pro",
      title: "Upgrade to Pro",
      description: "Twice the daily balance and priority support",
    })
  })

  it("defaults older responses without a plan to the Free upsell", () => {
    expect(getLimitUpgradeCopy(undefined)?.targetPlan).toBe("pro")
  })

  it("offers Unlimited instead of Pro to existing Pro users", () => {
    expect(getLimitUpgradeCopy("pro")).toEqual({
      targetPlan: "unlimited",
      title: "Upgrade to Unlimited",
      description: "Unlimited usage on all shared pools and priority support",
    })
  })

  it("does not offer a redundant upgrade to Unlimited users", () => {
    expect(getLimitUpgradeCopy("unlimited")).toBeNull()
  })
})
