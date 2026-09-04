import { describe, expect, it } from "vitest"
import {
  formatUsageLimitMessage,
  getLimitUpgradeCopy,
} from "./usage-limit-copy"

describe("formatUsageLimitMessage", () => {
  it("leads with topping up when there is no deficit", () => {
    expect(formatUsageLimitMessage({})).toBe(
      "You're out of credits. Top up to continue, add your own API key, " +
      "or switch to a free model."
    )
  })

  it("treats a zero balance the same as an absent one", () => {
    expect(formatUsageLimitMessage({ creditBalance: 0 })).toBe(
      formatUsageLimitMessage({})
    )
  })

  it("explains a deficit instead of the generic out-of-credits message", () => {
    const msg = formatUsageLimitMessage({ creditBalance: -12.5 })
    expect(msg).toBe(
      "Your last turn ran $12.50 past your credits. " +
      "Top up to clear it, add your own API key, or switch to a free model."
    )
  })

  it("names no provider — the balance is pooled across all three", () => {
    const msg = formatUsageLimitMessage({})
    for (const provider of ["Claude", "Gemini", "OpenCode"]) {
      expect(msg).not.toContain(provider)
    }
  })
})

describe("getLimitUpgradeCopy", () => {
  // Free and Pro are gated identically on credits, so only Unlimited (which
  // bypasses the credit gate entirely) is worth offering to either.
  it("offers Unlimited to free users", () => {
    expect(getLimitUpgradeCopy("free")).toEqual({
      targetPlan: "unlimited",
      title: "Upgrade to Unlimited",
      description: "Unlimited usage on all shared pools and priority support",
    })
  })

  it("offers Unlimited to existing Pro users too", () => {
    expect(getLimitUpgradeCopy("pro")).toEqual({
      targetPlan: "unlimited",
      title: "Upgrade to Unlimited",
      description: "Unlimited usage on all shared pools and priority support",
    })
  })

  it("defaults older responses without a plan to the Unlimited upsell", () => {
    expect(getLimitUpgradeCopy(undefined)?.targetPlan).toBe("unlimited")
  })

  it("does not offer a redundant upgrade to Unlimited users", () => {
    expect(getLimitUpgradeCopy("unlimited")).toBeNull()
  })
})
