import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { ParseContext } from "../../src/core/agent.js"

// Helper to create a fresh parse context
export function createContext(): ParseContext {
  return { state: {}, sessionId: null }
}

/**
 * Read a captured JSONL reference fixture from tests/fixtures/jsonl-reference/
 * and split it into its non-empty lines.
 */
export function readFixtureLines(fixtureName: string): string[] {
  const contents = readFileSync(
    join(__dirname, "../fixtures/jsonl-reference", fixtureName),
    "utf-8"
  )
  return contents.split("\n").filter(Boolean)
}

/**
 * Replay a captured JSONL fixture through a parser, one line at a time, and
 * return the flat, null-filtered list of events it produces (in order).
 *
 * Each line's `Event | Event[] | null` result is flattened into the output
 * array, matching the shape parsers use for lines that emit more than one
 * event. `parseLine` is a closure so callers can bind their own tool
 * mappings and — for stateful parsers — a single `ParseContext` shared
 * across the whole replay (lines are parsed in order, so mutations to a
 * context captured by the closure behave the same as a manual loop).
 */
export function parseFixtureEvents<E>(
  fixtureName: string,
  parseLine: (line: string) => E | E[] | null
): E[] {
  return readFixtureLines(fixtureName)
    .map(parseLine)
    .filter((event): event is E | E[] => event !== null)
    .flat() as E[]
}
