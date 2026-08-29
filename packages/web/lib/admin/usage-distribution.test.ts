/**
 * Unit tests for the usage-distribution arithmetic.
 *
 * These numbers are going to drive real tier-limit decisions, so the percentile
 * and simulation maths are pinned here rather than eyeballed on a chart.
 */
import { describe, it, expect } from "vitest"
import {
  activeUserDays,
  buildHistogram,
  formatUnitValue,
  percentOf,
  percentile,
  percentiles,
  simulateLimit,
  userTotals,
  type UserDailyUsage,
} from "./usage-distribution"

const users: UserDailyUsage[] = [
  { userId: "a", name: "Ann", daily: [1, 0, 3] }, // active 2 days, total 4
  { userId: "b", name: "Bo", daily: [0, 0, 0] }, // never active
  { userId: "c", name: "Cy", daily: [10, 20, 0] }, // active 2 days, total 30
]

describe("percentile", () => {
  it("returns 0 for an empty sample", () => {
    expect(percentile([], 50)).toBe(0)
  })

  it("returns the only value for a single-element sample", () => {
    expect(percentile([7], 50)).toBe(7)
    expect(percentile([7], 99)).toBe(7)
  })

  it("interpolates between neighbours", () => {
    // p50 of [1,2,3,4] sits between 2 and 3.
    expect(percentile([1, 2, 3, 4], 50)).toBe(2.5)
  })

  it("returns the extremes at p0 and p100", () => {
    expect(percentile([5, 1, 9], 0)).toBe(1)
    expect(percentile([5, 1, 9], 100)).toBe(9)
  })

  it("does not depend on input order", () => {
    expect(percentile([9, 1, 5], 50)).toBe(percentile([1, 5, 9], 50))
  })
})

describe("percentiles", () => {
  it("returns an all-zero summary for an empty sample", () => {
    expect(percentiles([])).toEqual({ p50: 0, p90: 0, p99: 0, max: 0, mean: 0 })
  })

  it("computes max and mean", () => {
    const p = percentiles([1, 2, 3, 4])
    expect(p.max).toBe(4)
    expect(p.mean).toBe(2.5)
  })
})

describe("activeUserDays", () => {
  it("flattens to one value per active user-day, dropping idle days", () => {
    // Idle days are excluded on purpose: a daily cap only binds on active days,
    // so counting zeros would drag every percentile toward zero.
    expect(activeUserDays(users).sort((a, b) => a - b)).toEqual([1, 3, 10, 20])
  })

  it("returns [] when nobody was active", () => {
    expect(activeUserDays([{ userId: "z", name: "Zed", daily: [0, 0] }])).toEqual([])
  })
})

describe("userTotals", () => {
  it("sums per user, drops zero-usage users, and sorts descending", () => {
    expect(userTotals(users)).toEqual([
      { userId: "c", name: "Cy", image: undefined, total: 30 },
      { userId: "a", name: "Ann", image: undefined, total: 4 },
    ])
  })
})

describe("buildHistogram", () => {
  const fmt = (v: number) => String(v)

  it("returns [] for an empty or all-zero sample", () => {
    expect(buildHistogram([], fmt)).toEqual([])
    expect(buildHistogram([0, 0], fmt)).toEqual([])
  })

  it("places every positive value in exactly one bucket", () => {
    const values = [0.5, 1, 3, 7, 12, 40, 90, 300]
    const buckets = buildHistogram(values, fmt)
    const total = buckets.reduce((acc, b) => acc + b.count, 0)
    expect(total).toBe(values.length)
  })

  it("ignores zeros in the counts", () => {
    const buckets = buildHistogram([0, 0, 5], fmt)
    expect(buckets.reduce((acc, b) => acc + b.count, 0)).toBe(1)
  })

  it("produces non-overlapping ascending buckets", () => {
    const buckets = buildHistogram([1, 10, 100, 1000], fmt)
    for (let i = 1; i < buckets.length; i++) {
      expect(buckets[i].min).toBeGreaterThanOrEqual(buckets[i - 1].max)
    }
  })

  it("ends with an open-ended bucket", () => {
    const buckets = buildHistogram([1, 500], fmt)
    expect(buckets[buckets.length - 1].max).toBe(Infinity)
    expect(buckets[buckets.length - 1].label).toContain("+")
  })
})

describe("simulateLimit", () => {
  it("counts nothing as throttled when the limit is above every value", () => {
    const s = simulateLimit(users, 1000)
    expect(s.usersAffected).toBe(0)
    expect(s.daysThrottled).toBe(0)
    expect(s.usagePrevented).toBe(0)
  })

  it("reports totals over active user-days only", () => {
    const s = simulateLimit(users, 1000)
    // Bo never used anything, so is excluded from both totals.
    expect(s.usersTotal).toBe(2)
    expect(s.daysTotal).toBe(4)
    expect(s.usageTotal).toBe(34)
  })

  it("counts a user once even when they exceed the cap on several days", () => {
    const s = simulateLimit(users, 5)
    expect(s.usersAffected).toBe(1) // only Cy
    expect(s.daysThrottled).toBe(2) // but on two days
  })

  it("sums only the overage, not the whole day's usage", () => {
    // Cy: (10-5) + (20-5) = 20. Ann is under the cap on both active days.
    expect(simulateLimit(users, 5).usagePrevented).toBe(20)
  })

  it("treats a value exactly at the limit as allowed", () => {
    const s = simulateLimit([{ userId: "x", name: "X", daily: [10] }], 10)
    expect(s.daysThrottled).toBe(0)
    expect(s.usagePrevented).toBe(0)
  })

  it("treats a zero/negative limit as no limit rather than throttling everything", () => {
    const s = simulateLimit(users, 0)
    expect(s.daysThrottled).toBe(0)
    expect(s.usagePrevented).toBe(0)
  })

  it("handles an empty user list without dividing by zero", () => {
    const s = simulateLimit([], 5)
    expect(s).toMatchObject({ usersTotal: 0, daysTotal: 0, usageTotal: 0 })
  })
})

describe("formatUnitValue", () => {
  it("formats cost with precision scaled to magnitude", () => {
    expect(formatUnitValue("cost", 0)).toBe("$0")
    expect(formatUnitValue("cost", 0.0004)).toBe("$0.0004")
    expect(formatUnitValue("cost", 0.5)).toBe("$0.500")
    expect(formatUnitValue("cost", 1234.5)).toBe("$1,234.50")
  })

  it("compacts token counts", () => {
    expect(formatUnitValue("tokens", 999)).toBe("999")
    expect(formatUnitValue("tokens", 1500)).toBe("1.5k")
    expect(formatUnitValue("tokens", 2_500_000)).toBe("2.5M")
  })

  it("renders message counts as plain integers", () => {
    expect(formatUnitValue("messages", 1234)).toBe("1,234")
  })
})

describe("percentOf", () => {
  it("returns 0 rather than NaN for a zero denominator", () => {
    expect(percentOf(5, 0)).toBe(0)
  })

  it("computes a percentage", () => {
    expect(percentOf(1, 4)).toBe(25)
  })
})
