"use client"

import {
  INTERVAL_PRESETS,
  INTERVAL_UNITS,
  CUSTOM_INTERVAL,
  inferIntervalMode,
  type IntervalUnit,
} from "@/lib/scheduled-jobs/intervals"
import { DAYS_OF_WEEK, TIME_OPTIONS } from "./constants"

interface ScheduleFieldsProps {
  isCustomInterval: boolean
  setIsCustomInterval: (v: boolean) => void
  intervalMinutes: number
  setIntervalMinutes: (v: number) => void
  customIntervalValue: number
  setCustomIntervalValue: (v: number) => void
  customIntervalUnit: IntervalUnit
  setCustomIntervalUnit: (v: IntervalUnit) => void
  effectiveIntervalMinutes: number
  runAtDay: number
  setRunAtDay: (v: number) => void
  runAtHourLocal: number
  setRunAtHourLocal: (v: number) => void
  timezoneName: string
}

const inputClass =
  "rounded-md border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring"

/**
 * Cadence picker for interval-triggered jobs: a preset/custom interval, plus
 * day-of-week (weekly) and time-of-day (daily and longer) selectors.
 */
export function ScheduleFields({
  isCustomInterval,
  setIsCustomInterval,
  intervalMinutes,
  setIntervalMinutes,
  customIntervalValue,
  setCustomIntervalValue,
  customIntervalUnit,
  setCustomIntervalUnit,
  effectiveIntervalMinutes,
  runAtDay,
  setRunAtDay,
  runAtHourLocal,
  setRunAtHourLocal,
  timezoneName,
}: ScheduleFieldsProps) {
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
          className={inputClass}
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
              className={inputClass}
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
              className={inputClass}
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
              className={inputClass}
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
