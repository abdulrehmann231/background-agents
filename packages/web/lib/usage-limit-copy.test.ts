import { describe, expect, it } from "vitest"
import { formatUsageLimitMessage } from "./usage-limit-copy"

describe("formatUsageLimitMessage", () => {
  it("names both empty pots, and the reset that refills one of them", () => {
    expect(formatUsageLimitMessage({ limit: 5 })).toBe(
      "Daily limit reached ($5.00) and you're out of credits. " +
      "Top up to continue, add your own API key, or switch to a free model — " +
      "or wait for your daily balance to reset at midnight UTC."
    )
  })

  it("treats a zero balance the same as an absent one", () => {
    expect(formatUsageLimitMessage({ limit: 5, creditBalance: 0 })).toBe(
      formatUsageLimitMessage({ limit: 5 })
    )
  })

  it("scales the named limit with the plan's allowance", () => {
    expect(formatUsageLimitMessage({ limit: 10 })).toContain("($10.00)")
  })

  it("explains a deficit instead of the generic message", () => {
    expect(formatUsageLimitMessage({ limit: 5, creditBalance: -12.5 })).toBe(
      "Daily limit reached ($5.00), and your last turn ran $12.50 past your credits. " +
      "Top up to clear it, add your own API key, or switch to a free model."
    )
  })

  it("does not promise a reset to a user in deficit — it would not unblock them", () => {
    const msg = formatUsageLimitMessage({ limit: 5, creditBalance: -1 })
    expect(msg).not.toContain("reset")
    expect(msg).not.toContain("midnight")
  })

  it("names no provider — the balance is pooled across all three", () => {
    const msg = formatUsageLimitMessage({ limit: 5 })
    for (const provider of ["Claude", "Gemini", "OpenCode"]) {
      expect(msg).not.toContain(provider)
    }
  })
})
