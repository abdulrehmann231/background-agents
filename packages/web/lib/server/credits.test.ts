/**
 * Unit tests for credit units, the shared-pool discount, and the
 * daily-then-credits split.
 */
import { describe, it, expect } from "vitest"

import {
  chargeableUsd,
  DISCOUNT_DIVISOR,
  discountDivisorFor,
  MICRO_PER_USD,
  microToUsd,
  splitTurnCost,
  stripeAmountToMicro,
  usdToMicro,
} from "./credits"

describe("stripeAmountToMicro", () => {
  it("converts Stripe's integer cents exactly", () => {
    expect(stripeAmountToMicro(1000)).toBe(10_000_000n) // $10.00
    expect(stripeAmountToMicro(1)).toBe(10_000n) // $0.01
  })

  it("keeps an amount a float round-trip would spoil", () => {
    // $10.07 via dollars is 10.07 * 1e6 = 10069999.999999998 before rounding.
    // Straight from cents there is no float in the path at all.
    expect(stripeAmountToMicro(1007)).toBe(10_070_000n)
    expect(stripeAmountToMicro(1007)).toBe(usdToMicro(10.07))
  })

  it("refuses a non-integer amount rather than rounding money", () => {
    // Stripe only ever sends integer minor units; anything else means we are
    // reading the wrong field, and guessing would mis-credit a real payment.
    expect(stripeAmountToMicro(10.5)).toBe(0n)
  })
})

describe("usdToMicro", () => {
  it("round-trips a dollar amount", () => {
    expect(usdToMicro(12.34)).toBe(12_340_000n)
    expect(microToUsd(12_340_000n)).toBeCloseTo(12.34, 10)
  })

  it("keeps sub-cent costs, which is the whole reason for the unit", () => {
    // A turn costing a fifth of a cent. Cents would round this to 0 (a free
    // route around the cap) or to 1 (a 5x overcharge).
    expect(usdToMicro(0.002)).toBe(2_000n)
  })

  it("absorbs the float residue the ledger produces", () => {
    // sumSharedSpend differences floats; a no-op lands here rather than on 0.
    expect(usdToMicro(4e-16)).toBe(0n)
  })

  it("is exact for a whole-dollar top-up", () => {
    expect(usdToMicro(100)).toBe(BigInt(100 * MICRO_PER_USD))
  })

  it("treats a non-finite cost as zero rather than throwing", () => {
    // BigInt(NaN) throws, which inside the metering transaction would lose the
    // whole turn's usage row, not just the debit.
    expect(usdToMicro(Number.NaN)).toBe(0n)
    expect(usdToMicro(Number.POSITIVE_INFINITY)).toBe(0n)
  })
})

describe("splitTurnCost", () => {
  it("takes the whole cost from the allowance when it fits", () => {
    expect(splitTurnCost({ cost: 2, dailyLeft: 5 })).toEqual({
      fromDaily: 2,
      fromCredits: 0,
    })
  })

  it("straddles the boundary, spending the allowance down to zero first", () => {
    const split = splitTurnCost({ cost: 8, dailyLeft: 5 })
    expect(split.fromDaily).toBeCloseTo(5, 10)
    expect(split.fromCredits).toBeCloseTo(3, 10)
  })

  it("charges everything to credits once the allowance is gone", () => {
    expect(splitTurnCost({ cost: 4, dailyLeft: 0 })).toEqual({
      fromDaily: 0,
      fromCredits: 4,
    })
  })

  it("never touches credits on an uncapped plan", () => {
    expect(splitTurnCost({ cost: 400, dailyLeft: Infinity })).toEqual({
      fromDaily: 400,
      fromCredits: 0,
    })
  })

  it("does not clamp an overshoot — the deficit is real and must be recorded", () => {
    // The gate lets a turn start on any positive balance, so a $476 run against
    // a spent allowance charges $476 to credits however little is left. Clamping
    // here would forgive it, and make a $1 top-up an unlimited turn.
    expect(splitTurnCost({ cost: 476, dailyLeft: 0 }).fromCredits).toBe(476)
  })

  it("ignores a negative allowance rather than crediting the user for it", () => {
    // Defensive: `used > allowance` after an overshoot could reach here as a
    // negative dailyLeft, which must not add itself to the credit charge.
    expect(splitTurnCost({ cost: 3, dailyLeft: -10 })).toEqual({
      fromDaily: 0,
      fromCredits: 3,
    })
  })

  it("splits nothing for a zero or unpriced turn", () => {
    expect(splitTurnCost({ cost: 0, dailyLeft: 5 })).toEqual({
      fromDaily: 0,
      fromCredits: 0,
    })
    expect(splitTurnCost({ cost: Number.NaN, dailyLeft: 5 })).toEqual({
      fromDaily: 0,
      fromCredits: 0,
    })
  })
})

describe("discountDivisorFor", () => {
  it("returns the configured divisor for each subsidised pool", () => {
    expect(discountDivisorFor("claude")).toBe(20)
    expect(discountDivisorFor("opencode")).toBe(2)
    expect(discountDivisorFor("gemini")).toBe(2)
  })

  it("charges list value for a provider we do not subsidise", () => {
    // Pi, Droid, Kilo and Kimi are always own-key, so they never reach the
    // charging path — but an unknown id must never be cheaper by accident.
    expect(discountDivisorFor("pi")).toBe(1)
    expect(discountDivisorFor("droid")).toBe(1)
    expect(discountDivisorFor("")).toBe(1)
  })

  it("falls back to list value when the constant itself is nonsense", () => {
    // A mistyped divisor must not make a turn free or pay the user to run one.
    const bad = DISCOUNT_DIVISOR as Record<string, number>
    for (const value of [0, -20, Number.NaN, Number.POSITIVE_INFINITY]) {
      bad.__test__ = value
      expect(discountDivisorFor("__test__")).toBe(1)
    }
    delete bad.__test__
  })
})

describe("chargeableUsd", () => {
  it("divides list value by the provider's divisor", () => {
    // The ledger's own per-turn averages, so these are the real figures.
    expect(chargeableUsd("claude", 2.4458)).toBeCloseTo(0.12229, 6)
    expect(chargeableUsd("opencode", 0.0887)).toBeCloseTo(0.04435, 6)
    expect(chargeableUsd("gemini", 0.0563)).toBeCloseTo(0.02815, 6)
  })

  it("leaves an unsubsidised provider at list value", () => {
    expect(chargeableUsd("kimi", 0.1089)).toBe(0.1089)
  })

  it("round-trips back to list value through the divisor", () => {
    // The inverse is what makes an old ledger row reproducible after the
    // constants move, so it has to actually hold.
    const listUsd = 2.4458
    const charged = chargeableUsd("claude", listUsd)
    expect(charged * discountDivisorFor("claude")).toBeCloseTo(listUsd, 10)
  })

  it("charges nothing for a zero, negative or unpriced turn", () => {
    expect(chargeableUsd("claude", 0)).toBe(0)
    expect(chargeableUsd("claude", -1)).toBe(0)
    expect(chargeableUsd("claude", Number.NaN)).toBe(0)
  })

  it("stays above a micro-dollar for the cheapest genuine charge", () => {
    // $2.2e-4 is the cheapest real charge on the production ledger. Even at the
    // steepest divisor it must survive usdToMicro rather than rounding to a
    // free turn.
    expect(usdToMicro(chargeableUsd("claude", 2.2e-4))).toBeGreaterThan(0n)
  })
})
