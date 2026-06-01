// =============================================================================
// Timezone Helpers
// =============================================================================
//
// The scheduled-job form lets users pick a run time in their local timezone,
// but the backend stores the hour in UTC. These helpers convert between the
// two and surface a short timezone label for display.

/** Get the user's timezone offset in hours (e.g., -8 for PST) */
export function getTimezoneOffset(): number {
  return -new Date().getTimezoneOffset() / 60
}

/** Get short timezone name (e.g., "PST", "EST") */
export function getTimezoneName(): string {
  return new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' })
    .formatToParts(new Date())
    .find(part => part.type === 'timeZoneName')?.value ?? 'Local'
}

/** Convert local hour (0-23) to UTC hour */
export function localHourToUtc(localHour: number): number {
  const offset = getTimezoneOffset()
  let utcHour = localHour - offset
  if (utcHour < 0) utcHour += 24
  if (utcHour >= 24) utcHour -= 24
  return Math.floor(utcHour)
}

/** Convert UTC hour (0-23) to local hour */
export function utcHourToLocal(utcHour: number): number {
  const offset = getTimezoneOffset()
  let localHour = utcHour + offset
  if (localHour < 0) localHour += 24
  if (localHour >= 24) localHour -= 24
  return Math.floor(localHour)
}
