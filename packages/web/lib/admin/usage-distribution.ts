/**
 * Pure helpers for the admin usage-distribution view.
 *
 * These turn the raw per-user/per-day usage matrix returned by
 * `/api/admin/usage-distribution` into the three things the dashboard needs:
 * a histogram, a percentile summary, and a retrospective answer to "what would
 * this daily limit have cut off?".
 *
 * All pure and deterministic — no React, no I/O — so the arithmetic that will
 * decide real tier limits is unit-testable rather than buried in a chart.
 */

import type { BudgetUnit } from "@/lib/server/usage-budgets"

/** One user's usage, as a value per day of the selected range. */
export interface UserDailyUsage {
  userId: string
  name: string
  image?: string | null
  /** One entry per day in the range, aligned to the response's `days` array. */
  daily: number[]
}

// =============================================================================
// Percentiles
// =============================================================================

export interface Percentiles {
  p50: number
  p90: number
  p99: number
  max: number
  mean: number
}

/**
 * Linear-interpolated percentile over an unsorted sample. Returns 0 for an
 * empty sample so callers can render a zero state without branching.
 */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  if (sorted.length === 1) return sorted[0]
  const rank = (p / 100) * (sorted.length - 1)
  const lower = Math.floor(rank)
  const upper = Math.ceil(rank)
  if (lower === upper) return sorted[rank]
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (rank - lower)
}

/** p50/p90/p99/max/mean for a sample. */
export function percentiles(values: number[]): Percentiles {
  if (values.length === 0) {
    return { p50: 0, p90: 0, p99: 0, max: 0, mean: 0 }
  }
  const sum = values.reduce((acc, v) => acc + v, 0)
  return {
    p50: percentile(values, 50),
    p90: percentile(values, 90),
    p99: percentile(values, 99),
    max: Math.max(...values),
    mean: sum / values.length,
  }
}

// =============================================================================
// Sample extraction
// =============================================================================

/**
 * Flatten the matrix into the sample the limit actually applies to: one value
 * per user per day, dropping zero-usage days.
 *
 * Zero days are excluded deliberately. A daily budget only ever binds on a day
 * the user was active, so including the (many) idle days would drag every
 * percentile toward zero and make the distribution look far lighter than the
 * usage a limit would meet in practice.
 */
export function activeUserDays(users: UserDailyUsage[]): number[] {
  const out: number[] = []
  for (const u of users) {
    for (const v of u.daily) {
      if (v > 0) out.push(v)
    }
  }
  return out
}

/** Per-user totals across the whole range (used for the top-consumer list). */
export function userTotals(
  users: UserDailyUsage[]
): Array<{ userId: string; name: string; image?: string | null; total: number }> {
  return users
    .map((u) => ({
      userId: u.userId,
      name: u.name,
      image: u.image,
      total: u.daily.reduce((acc, v) => acc + v, 0),
    }))
    .filter((u) => u.total > 0)
    .sort((a, b) => b.total - a.total)
}

// =============================================================================
// Histogram
// =============================================================================

export interface HistogramBucket {
  /** Inclusive lower bound. */
  min: number
  /** Exclusive upper bound; Infinity for the final open-ended bucket. */
  max: number
  /** Display label, e.g. "$0.10–0.50" or "10k–50k". */
  label: string
  /** Number of samples in this bucket. */
  count: number
}

/**
 * Bucket a sample on a 1–2.5–5–10 log scale.
 *
 * Usage is heavily long-tailed: most active days are near zero while a handful
 * run orders of magnitude higher. Linear buckets would put ~95% of the mass in
 * the first bar and tell you nothing. A log scale keeps every decade legible,
 * which is what makes the "where should the cap go" question answerable by eye.
 */
export function buildHistogram(
  values: number[],
  format: (v: number) => string
): HistogramBucket[] {
  if (values.length === 0) return []

  const max = Math.max(...values)
  const positive = values.filter((v) => v > 0)
  const min = positive.length > 0 ? Math.min(...positive) : 0
  if (max <= 0) return []

  // Start a decade below the smallest observed value (floored at 1e-4 so tiny
  // per-turn costs don't generate dozens of empty buckets).
  const startExp = Math.max(-4, Math.floor(Math.log10(min || max)))
  const endExp = Math.floor(Math.log10(max))

  const edges: number[] = []
  for (let exp = startExp; exp <= endExp; exp++) {
    const decade = Math.pow(10, exp)
    for (const mult of [1, 2.5, 5]) {
      const edge = decade * mult
      if (edge <= max) edges.push(edge)
    }
  }
  // Guarantee at least one bucket even when every value sits in one decade.
  if (edges.length === 0) edges.push(max)
  edges.push(Infinity)

  const buckets: HistogramBucket[] = edges.slice(0, -1).map((lo, i) => {
    const hi = edges[i + 1]
    return {
      min: lo,
      max: hi,
      label: hi === Infinity ? `${format(lo)}+` : `${format(lo)}–${format(hi)}`,
      count: 0,
    }
  })

  for (const v of values) {
    if (v <= 0) continue
    // Values below the first edge belong to the first bucket.
    let idx = buckets.findIndex((b) => v >= b.min && v < b.max)
    if (idx === -1) idx = v < buckets[0].min ? 0 : buckets.length - 1
    buckets[idx].count++
  }

  return buckets
}

// =============================================================================
// Limit simulation
// =============================================================================

export interface LimitSimulation {
  /** Candidate daily limit that was simulated. */
  limit: number
  /** Users who would have hit the cap on at least one day. */
  usersAffected: number
  /** Total users with any usage in the range. */
  usersTotal: number
  /** (user, day) pairs where usage exceeded the cap. */
  daysThrottled: number
  /** Total active (user, day) pairs. */
  daysTotal: number
  /** Usage above the cap that would not have been served. */
  usagePrevented: number
  /** Total usage across the range. */
  usageTotal: number
}

/**
 * Retrospectively apply a daily limit to recorded usage.
 *
 * Answers "if this cap had been in force, who would have hit it, how often, and
 * how much usage would it have stopped?" — the numbers needed to pick a tier
 * limit from evidence instead of guessing.
 *
 * Caveat worth surfacing wherever this is displayed: it assumes demand is
 * unchanged by the cap. In reality a throttled user retries the next day, so
 * `usagePrevented` is an upper bound on savings, not a forecast.
 */
export function simulateLimit(
  users: UserDailyUsage[],
  limit: number
): LimitSimulation {
  let usersAffected = 0
  let usersTotal = 0
  let daysThrottled = 0
  let daysTotal = 0
  let usagePrevented = 0
  let usageTotal = 0

  for (const u of users) {
    let userHadUsage = false
    let userHitCap = false

    for (const v of u.daily) {
      if (v <= 0) continue
      userHadUsage = true
      daysTotal++
      usageTotal += v
      if (limit > 0 && v > limit) {
        userHitCap = true
        daysThrottled++
        usagePrevented += v - limit
      }
    }

    if (userHadUsage) usersTotal++
    if (userHitCap) usersAffected++
  }

  return {
    limit,
    usersAffected,
    usersTotal,
    daysThrottled,
    daysTotal,
    usagePrevented,
    usageTotal,
  }
}

// =============================================================================
// Formatting
// =============================================================================

/**
 * Format a value in a provider's budget unit. Mirrors the chart formatters but
 * keys off the ledger's `BudgetUnit` rather than the dashboard metric, since a
 * provider's budget can be denominated in tokens, USD, or message count.
 */
export function formatUnitValue(unit: BudgetUnit, value: number): string {
  if (unit === "cost") {
    if (value === 0) return "$0"
    if (Math.abs(value) < 0.01) return `$${value.toFixed(4)}`
    if (Math.abs(value) < 1) return `$${value.toFixed(3)}`
    return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }
  if (unit === "tokens") {
    const abs = Math.abs(value)
    if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`
    if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
    if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}k`
    return `${Math.round(value)}`
  }
  return Math.round(value).toLocaleString()
}

/** Percentage helper that renders 0 rather than NaN for an empty denominator. */
export function percentOf(part: number, whole: number): number {
  if (whole <= 0) return 0
  return (part / whole) * 100
}
