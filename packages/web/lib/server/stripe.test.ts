/**
 * The price map is the security boundary for checkout: the client sends a pack
 * id, and an amount only for the custom-amount price, so what can be bought is
 * exactly what this resolves. These tests pin that boundary, and the kill
 * switch that fails closed.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest"

import { getPriceMap, isBillingEnabled } from "./stripe"

const ENV_KEYS = [
  "STRIPE_PRICE_MAP",
  "BILLING_ENABLED",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
] as const

let saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {}

beforeEach(() => {
  saved = {}
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

describe("getPriceMap", () => {
  it("resolves a pack the environment sells", () => {
    process.env.STRIPE_PRICE_MAP = JSON.stringify({ pack_10: "price_abc" })
    expect(getPriceMap().pack_10).toBe("price_abc")
  })

  it("refuses a pack id that is not in the map", () => {
    process.env.STRIPE_PRICE_MAP = JSON.stringify({ pack_10: "price_abc" })
    expect(getPriceMap().pack_1000000).toBeUndefined()
  })

  it("refuses anything that is not a Stripe price id", () => {
    // A map entry pointing at some other object — or at a string a caller
    // smuggled in — must not become a line item.
    process.env.STRIPE_PRICE_MAP = JSON.stringify({
      good: "price_abc",
      bad: "prod_abc",
      worse: "sk_live_abc",
    })
    const map = getPriceMap()
    expect(map.good).toBe("price_abc")
    expect(map.bad).toBeUndefined()
    expect(map.worse).toBeUndefined()
  })

  it("sells nothing when the map is missing or malformed", () => {
    expect(getPriceMap()).toEqual({})

    process.env.STRIPE_PRICE_MAP = "not json"
    expect(getPriceMap()).toEqual({})

    // An array parses as JSON but is not a map; it must not yield index lookups.
    process.env.STRIPE_PRICE_MAP = JSON.stringify(["price_abc"])
    expect(getPriceMap()).toEqual({})
  })
})

describe("isBillingEnabled", () => {
  it("is off unless every piece is configured", () => {
    expect(isBillingEnabled()).toBe(false)

    process.env.BILLING_ENABLED = "true"
    expect(isBillingEnabled()).toBe(false)

    process.env.STRIPE_SECRET_KEY = "sk_test_x"
    expect(isBillingEnabled()).toBe(false)

    process.env.STRIPE_WEBHOOK_SECRET = "whsec_x"
    expect(isBillingEnabled()).toBe(true)
  })

  it("stays off when the flag is anything but the literal string", () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x"
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_x"
    for (const value of ["1", "yes", "TRUE", ""]) {
      process.env.BILLING_ENABLED = value
      expect(isBillingEnabled()).toBe(false)
    }
  })
})
