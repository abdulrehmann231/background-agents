// =============================================================================
// Interval configuration for the scheduled-job form
// =============================================================================
//
// A scheduled job stores its cadence as a single `intervalMinutes` number. The
// form lets users pick that value either as one of a few presets or as a
// custom (value × unit) pair. These constants and helpers translate between the
// stored minutes and the form's preset/custom representation.

export const INTERVAL_PRESETS = [
  { label: "10 minutes", value: 10 },
  { label: "15 minutes", value: 15 },
  { label: "30 minutes", value: 30 },
  { label: "Hour", value: 60 },
  { label: "6 hours", value: 360 },
  { label: "Day", value: 1440 },
  { label: "Week", value: 10080 },
]

/** Sentinel `<select>` value that switches the interval picker into custom mode. */
export const CUSTOM_INTERVAL = -1

export type IntervalUnit = "minutes" | "hours" | "days" | "weeks"

export const UNIT_MINUTES: Record<IntervalUnit, number> = {
  minutes: 1,
  hours: 60,
  days: 1440,
  weeks: 10080,
}

export const INTERVAL_UNITS: { label: string; value: IntervalUnit }[] = [
  { label: "minutes", value: "minutes" },
  { label: "hours", value: "hours" },
  { label: "days", value: "days" },
  { label: "weeks", value: "weeks" },
]

/** Express a stored intervalMinutes as either a preset or a (value, unit) pair. */
export function inferIntervalMode(minutes: number): {
  isCustom: boolean
  intervalMinutes: number
  customValue: number
  customUnit: IntervalUnit
} {
  if (INTERVAL_PRESETS.some((p) => p.value === minutes)) {
    return { isCustom: false, intervalMinutes: minutes, customValue: 10, customUnit: "minutes" }
  }
  if (minutes % 10080 === 0) {
    return { isCustom: true, intervalMinutes: minutes, customValue: minutes / 10080, customUnit: "weeks" }
  }
  if (minutes % 1440 === 0) {
    return { isCustom: true, intervalMinutes: minutes, customValue: minutes / 1440, customUnit: "days" }
  }
  if (minutes % 60 === 0) {
    return { isCustom: true, intervalMinutes: minutes, customValue: minutes / 60, customUnit: "hours" }
  }
  return { isCustom: true, intervalMinutes: minutes, customValue: minutes, customUnit: "minutes" }
}
