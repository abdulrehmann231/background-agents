// Lightweight, diagnostic-only Prisma instrumentation.
//
// Purpose: decide whether moving the agent-lifecycle cron's hot polling off
// Neon (e.g. onto Redis) would actually save money. Neon bills by *time the
// compute is active*, not query count, so the question that matters is:
//
//   How many cron ticks touch Neon with only READS (which a Redis/Daytona
//   design could serve without waking Neon) vs. ticks that perform durable
//   WRITES (which genuinely need Neon)?
//
// This module counts reads vs. writes for a scoped window (one cron tick) so
// we can log that ratio. It's intentionally cheap (integer increments) and has
// no external dependencies. Remove once the Path 1 vs. Path 2 decision is made.

export interface DbMetrics {
  reads: number
  writes: number
  // Per-operation breakdown, keyed by `Model.action` (e.g. "Chat.update").
  byOp: Record<string, number>
}

// Prisma actions that mutate durable state. Everything else is treated as a
// read for the purposes of "could this have avoided waking Neon?".
const WRITE_ACTIONS = new Set([
  "create",
  "createMany",
  "createManyAndReturn",
  "update",
  "updateMany",
  "upsert",
  "delete",
  "deleteMany",
  "executeRaw",
  "executeRawUnsafe",
])

function emptyMetrics(): DbMetrics {
  return { reads: 0, writes: 0, byOp: {} }
}

// Module-level accumulator. Single-threaded per serverless invocation, so a
// module global is safe for scoping to one cron tick.
let current: DbMetrics = emptyMetrics()

export function resetDbMetrics(): void {
  current = emptyMetrics()
}

export function getDbMetrics(): DbMetrics {
  return current
}

export function recordDbOp(model: string | undefined, action: string): void {
  const isWrite = WRITE_ACTIONS.has(action)
  if (isWrite) current.writes++
  else current.reads++

  const key = `${model ?? "raw"}.${action}`
  current.byOp[key] = (current.byOp[key] ?? 0) + 1
}
