import { describe, expect, it } from "vitest"
import {
  formatUsageLimitMessage,
  getLimitUpgradeCopy,
} from "./usage-limit-copy"

describe("formatUsageLimitMessage", () => {
  it("leads with the top-up and describes Pro as a bigger balance for free users", () => {
    expect(formatUsageLimitMessage({ plan: "free", limit: 5 })).toBe(
      "Daily limit reached ($5.00). " +
      "Top up credits, upgrade to Pro for twice the daily balance, " +
      "add your own API key, or switch to a free model."
    )
  })

  it("only offers Unlimited, BYOK or free models after a Pro user runs out", () => {
    expect(formatUsageLimitMessage({ plan: "pro", limit: 10 })).toBe(
      "Daily limit reached ($10.00). " +
      "Top up credits, upgrade to Unlimited for uncapped usage, " +
      "add your own API key, or switch to a free model."
    )
  })

  it("explains a deficit instead of listing upgrades that would not clear it", () => {
    const msg = formatUsageLimitMessage({ plan: "free", limit: 5, creditBalance: -12.5 })
    expect(msg).toBe(
      "Daily limit reached ($5.00), and your last turn ran $12.50 past your credits. " +
      "Top up to clear it, add your own API key, or switch to a free model."
    )
    // A plan upgrade does not pay off a deficit, so it must not be offered here.
    expect(msg).not.toContain("Upgrade")
  })

  it("reads as the plain limit message when credits are simply absent", () => {
    expect(formatUsageLimitMessage({ plan: "free", limit: 5, creditBalance: 0 })).toBe(
      formatUsageLimitMessage({ plan: "free", limit: 5 })
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
