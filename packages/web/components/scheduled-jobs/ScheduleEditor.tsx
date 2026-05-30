"use client"

import {
  inferIntervalMode,
  INTERVAL_PRESETS,
  CUSTOM_INTERVAL,
  INTERVAL_UNITS,
  DAYS_OF_WEEK,
  TIME_OPTIONS,
  type IntervalUnit,
} from "@/lib/scheduled-jobs/form-helpers"

interface ScheduleEditorProps {
  intervalMinutes: number
  isCustomInterval: boolean
  customIntervalValue: number
  customIntervalUnit: IntervalUnit
  runAtDay: number
  runAtHourLocal: number
  /** Resolved interval (preset value, or custom value × unit) used for gating. */
  effectiveIntervalMinutes: number
  timezoneName: string
  setIntervalMinutes: (minutes: number) => void
  setIsCustomInterval: (custom: boolean) => void
  setCustomIntervalValue: (value: number) => void
  setCustomIntervalUnit: (unit: IntervalUnit) => void
  setRunAtDay: (day: number) => void
  setRunAtHourLocal: (hour: number) => void
}

const SELECT_CLASS =
  "rounded-md border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring"

/** "Run every …" interval / day-of-week / time-of-day controls for interval jobs. */
export function ScheduleEditor({
  intervalMinutes,
  isCustomInterval,
  customIntervalValue,
  customIntervalUnit,
  runAtDay,
  runAtHourLocal,
  effectiveIntervalMinutes,
  timezoneName,
  setIntervalMinutes,
  setIsCustomInterval,
  setCustomIntervalValue,
  setCustomIntervalUnit,
  setRunAtDay,
  setRunAtHourLocal,
}: ScheduleEditorProps) {
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Run every</span>
        <select
          value={isCustomInterval ? CUSTOM_INTERVAL : intervalMinutes}
          onChange={(e) => {
            const val = parseInt(e.target.value, 10)
            if (val === CUSTOM_INTERVAL) {
              // Seed custom inputs from the current preset so the effective
              // interval doesn't change just by toggling into Custom mode.
              const mode = inferIntervalMode(intervalMinutes)
              setIsCustomInterval(true)
              setCustomIntervalValue(mode.customValue)
              setCustomIntervalUnit(mode.customUnit)
            } else {
              setIsCustomInterval(false)
              setIntervalMinutes(val)
            }
          }}
          className={SELECT_CLASS}
        >
          {INTERVAL_PRESETS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
          <option value={CUSTOM_INTERVAL}>Custom…</option>
        </select>

        {isCustomInterval && (
          <>
            <input
              type="number"
              min={customIntervalUnit === "minutes" ? 10 : 1}
              step={1}
              value={customIntervalValue}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10)
                setCustomIntervalValue(Number.isFinite(n) ? Math.max(1, n) : 1)
              }}
              className="w-16 rounded-md border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <select
              value={customIntervalUnit}
              onChange={(e) => setCustomIntervalUnit(e.target.value as IntervalUnit)}
              className={SELECT_CLASS}
            >
              {INTERVAL_UNITS.map((u) => (
                <option key={u.value} value={u.value}>
                  {u.label}
                </option>
              ))}
            </select>
          </>
        )}

        {/* Day of week - only for exactly weekly */}
        {effectiveIntervalMinutes === 10080 && (
          <>
            <span className="text-muted-foreground">on</span>
            <select
              value={runAtDay}
              onChange={(e) => setRunAtDay(parseInt(e.target.value, 10))}
              className={SELECT_CLASS}
            >
              {DAYS_OF_WEEK.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </>
        )}

        {/* Time of day - for daily and weekly (preset or custom) */}
        {effectiveIntervalMinutes >= 1440 && (
          <>
            <span className="text-muted-foreground">at</span>
            <select
              value={runAtHourLocal}
              onChange={(e) => setRunAtHourLocal(parseInt(e.target.value, 10))}
              className={SELECT_CLASS}
            >
              {TIME_OPTIONS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            <span className="text-muted-foreground">{timezoneName}</span>
          </>
        )}
      </div>

      {isCustomInterval && effectiveIntervalMinutes < 10 && (
        <p className="text-xs text-destructive">
          Interval must be at least 10 minutes.
        </p>
      )}
    </div>
  )
}
