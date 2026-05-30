import type { Agent } from "@/lib/types"

// =============================================================================
// Shared form helpers and constants for the Scheduled Job form.
//
// These are pure (timezone helpers read the browser clock but take no other
// input) so they live outside the component for reuse and testability.
// =============================================================================

// -----------------------------------------------------------------------------
// Timezone helpers
// -----------------------------------------------------------------------------

/** Get the user's timezone offset in hours (e.g., -8 for PST). */
export function getTimezoneOffset(): number {
  return -new Date().getTimezoneOffset() / 60
}

/** Get short timezone name (e.g., "PST", "EST"). */
export function getTimezoneName(): string {
  return new Intl.DateTimeFormat("en-US", { timeZoneName: "short" })
    .formatToParts(new Date())
    .find((part) => part.type === "timeZoneName")?.value ?? "Local"
}

/** Wrap an hour into the 0-23 range. */
function wrapHour(hour: number): number {
  return Math.floor(((hour % 24) + 24) % 24)
}

/** Convert local hour (0-23) to UTC hour. */
export function localHourToUtc(localHour: number): number {
  return wrapHour(localHour - getTimezoneOffset())
}

/** Convert UTC hour (0-23) to local hour. */
export function utcHourToLocal(utcHour: number): number {
  return wrapHour(utcHour + getTimezoneOffset())
}

// -----------------------------------------------------------------------------
// Trigger types
// -----------------------------------------------------------------------------

export const TRIGGER_TYPES = [
  {
    label: "On a schedule",
    value: "interval",
    description: "Run at regular intervals",
  },
  {
    label: "Via webhook",
    value: "incoming",
    description:
      "Triggered by any external app (GitHub, Jira, Slack, Linear, …) — paste the generated URL into the source app",
  },
] as const

// -----------------------------------------------------------------------------
// Interval presets and units
// -----------------------------------------------------------------------------

export const INTERVAL_PRESETS = [
  { label: "10 minutes", value: 10 },
  { label: "15 minutes", value: 15 },
  { label: "30 minutes", value: 30 },
  { label: "Hour", value: 60 },
  { label: "6 hours", value: 360 },
  { label: "Day", value: 1440 },
  { label: "Week", value: 10080 },
]

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
  if (minutes % UNIT_MINUTES.weeks === 0) {
    return { isCustom: true, intervalMinutes: minutes, customValue: minutes / UNIT_MINUTES.weeks, customUnit: "weeks" }
  }
  if (minutes % UNIT_MINUTES.days === 0) {
    return { isCustom: true, intervalMinutes: minutes, customValue: minutes / UNIT_MINUTES.days, customUnit: "days" }
  }
  if (minutes % UNIT_MINUTES.hours === 0) {
    return { isCustom: true, intervalMinutes: minutes, customValue: minutes / UNIT_MINUTES.hours, customUnit: "hours" }
  }
  return { isCustom: true, intervalMinutes: minutes, customValue: minutes, customUnit: "minutes" }
}

// -----------------------------------------------------------------------------
// Day-of-week and time-of-day options
// -----------------------------------------------------------------------------

export const DAYS_OF_WEEK = [
  { label: "Monday", value: 1 },
  { label: "Tuesday", value: 2 },
  { label: "Wednesday", value: 3 },
  { label: "Thursday", value: 4 },
  { label: "Friday", value: 5 },
  { label: "Saturday", value: 6 },
  { label: "Sunday", value: 0 },
]

/** Hourly time-of-day options, "12:00 AM" … "11:00 PM", keyed by 0-23 hour. */
export const TIME_OPTIONS = Array.from({ length: 24 }, (_, hour) => {
  const period = hour < 12 ? "AM" : "PM"
  const hour12 = hour % 12 === 0 ? 12 : hour % 12
  return { label: `${hour12}:00 ${period}`, value: hour }
})

// -----------------------------------------------------------------------------
// Agents
// -----------------------------------------------------------------------------

export const AVAILABLE_AGENTS: Agent[] = ["opencode", "claude-code", "codex"]
