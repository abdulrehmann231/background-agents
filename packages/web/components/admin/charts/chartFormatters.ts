/**
 * Shared value formatters for the admin charts.
 *
 * These are used by recharts tick/label/tooltip formatters, which pass the
 * raw axis value (a date string or numeric hour) as `any`.
 */

/** Format a date value as a compact "M/D" axis tick, e.g. "5/27". */
export function formatAxisDate(value: string | number): string {
  const date = new Date(value)
  return `${date.getMonth() + 1}/${date.getDate()}`
}

/** Format a date value as a long tooltip label, e.g. "Tue, May 27". */
export function formatTooltipDate(value: string | number): string {
  const date = new Date(value)
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
}

/** Format an hour (0-23) as a 12-hour label, e.g. "12am", "3pm". */
export function formatHour(hour: number): string {
  if (hour === 0) return "12am"
  if (hour === 12) return "12pm"
  if (hour < 12) return `${hour}am`
  return `${hour - 12}pm`
}
