/**
 * Stall detection for background agent turns.
 *
 * Some agent CLIs (notably OpenCode) can wedge without ever emitting a terminal
 * event: when a model's rate/usage/quota limit is hit, the underlying AI SDK
 * silently retries with backoff — or the upstream streaming response stalls —
 * so the process stays alive but writes nothing to stdout. No `error` line, no
 * `step_finish`, no `end`. There is therefore nothing for a parser to catch:
 * the turn just reports "running" forever and the UI spins on "generating…".
 *
 * This module provides a pure, time-based watchdog the streaming layer uses to
 * break that deadlock: a turn that is still running but has produced no new
 * output for `timeoutMs` is treated as stalled and surfaced as an error.
 */

/**
 * Default time (ms) a turn may run without producing any new output before it
 * is considered stalled. Chosen to sit comfortably above realistic model
 * first-token latency and ordinary long tool calls, yet within a single SSE
 * connection window so the watchdog can actually fire before the connection is
 * recycled. Override per-deployment via the `AGENT_STALL_TIMEOUT_MS` env var.
 */
export const DEFAULT_STALL_TIMEOUT_MS = 240_000

/**
 * User-facing message for a stalled turn. Names the most common cause
 * (rate/usage/quota limit) and the available recovery actions.
 */
export const STALL_ERROR_MESSAGE =
  "The agent stopped producing output for an extended period and appears to be stuck. " +
  "This usually means a model rate, usage, or quota limit was reached and the agent is " +
  "silently retrying (or the upstream response stalled). Stopped waiting for it — you can " +
  "retry, switch to a different model, or check your plan's limits."

export interface StallCheck {
  /** True while the turn has not yet emitted a terminal (`end`/error) event. */
  running: boolean
  /** Milliseconds since the turn last produced new output / a new event. */
  msSinceLastActivity: number
  /**
   * Threshold after which a silent running turn is considered stalled.
   * Values <= 0 disable the watchdog. Defaults to DEFAULT_STALL_TIMEOUT_MS.
   */
  timeoutMs?: number
}

/**
 * Decide whether a still-running turn has gone silent long enough to be
 * considered stalled. Pure: the caller owns all the timing/state.
 *
 * Only running turns can stall — a turn that already produced a terminal event
 * is completed or errored and is handled by the normal path. A non-positive
 * `timeoutMs` disables detection entirely.
 */
export function isTurnStalled({
  running,
  msSinceLastActivity,
  timeoutMs = DEFAULT_STALL_TIMEOUT_MS,
}: StallCheck): boolean {
  if (!running) return false
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return false
  return msSinceLastActivity >= timeoutMs
}

/**
 * Resolve the stall timeout from an environment value (e.g.
 * `process.env.AGENT_STALL_TIMEOUT_MS`). Falls back to the default when unset
 * or unparseable; a value <= 0 disables the watchdog.
 */
export function resolveStallTimeoutMs(raw: string | undefined): number {
  if (raw == null || raw.trim() === "") return DEFAULT_STALL_TIMEOUT_MS
  const n = Number(raw)
  if (!Number.isFinite(n)) return DEFAULT_STALL_TIMEOUT_MS
  return n
}
