import { describe, expect, it } from "vitest"
import { formatUsageLimitMessage } from "./usage-limit-copy"

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
