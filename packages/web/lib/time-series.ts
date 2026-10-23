/**
 * Shared helpers for day/hour-bucketed admin usage series. Used by both the
 * admin dashboard (client) and the admin stats API route (server), so it
 * must stay framework-agnostic (no React/DOM APIs).
 */

/**
 * Sort rows bucketed by a `time` key. Hourly keys are plain numeric strings
 * ("0".."23") — a lexicographic sort would put "10" before "2", so sort
 * numerically in that case. Daily keys ("YYYY-MM-DD") sort fine
 * lexicographically.
 */
export function sortByTimeKey<T extends Record<string, number | string>>(
  rows: T[],
  isHourly: boolean
): T[] {
  return rows.sort((a, b) =>
    isHourly
      ? Number(a.time) - Number(b.time)
      : String(a.time).localeCompare(String(b.time))
  )
}
