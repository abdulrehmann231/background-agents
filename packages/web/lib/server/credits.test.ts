/**
 * Unit tests for the credit unit and its conversions.
 */
import { describe, it, expect } from "vitest"

import {
  MICRO_PER_USD,
  microToUsd,
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
