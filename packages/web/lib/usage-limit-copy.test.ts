import { describe, expect, it } from "vitest"
import {
  formatUsageLimitMessage,
  getLimitUpgradeCopy,
} from "./usage-limit-copy"

describe("formatUsageLimitMessage", () => {
  it("describes Pro as a higher limit for free users", () => {
    expect(formatUsageLimitMessage({
      plan: "free",
      provider: "claude",
      unit: "tokens",
      limit: 100_000,
    })).toBe(
      "Daily Claude limit reached (100,000 tokens). " +
      "Upgrade to Pro for higher daily limits, upgrade to Unlimited for unlimited usage, " +
      "or add your own Claude key."
    )
  })

  it("only offers Unlimited or BYOK after a Pro user reaches the limit", () => {
    expect(formatUsageLimitMessage({
      plan: "pro",
      provider: "gemini",
      unit: "messages",
      limit: 200,
    })).toBe(
      "Daily Gemini limit reached (200 messages). " +
      "Upgrade to Unlimited for unlimited usage, or add your own Gemini key."
    )
  })

  it("formats cost allowances without promising a plan upgrade to Unlimited users", () => {
    expect(formatUsageLimitMessage({
      plan: "unlimited",
      provider: "opencode",
      unit: "cost",
      limit: 1,
    })).toBe(
      "Daily OpenCode limit reached ($1.00). Add your own OpenCode key to continue."
    )
  })
})

describe("getLimitUpgradeCopy", () => {
  it("offers Pro with accurate benefits to free users", () => {
    expect(getLimitUpgradeCopy("free")).toEqual({
      targetPlan: "pro",
      title: "Upgrade to Pro",
      description: "Higher daily limits on all shared pools and priority support",
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
