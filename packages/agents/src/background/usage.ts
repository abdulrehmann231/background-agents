/**
 * tokscale usage normalization
 *
 * Pure functions for turning `tokscale --json` output into a normalized,
 * cumulative usage snapshot, and for diffing two snapshots to obtain a single
 * turn's usage. No state, no side effects - easily testable.
 *
 * tokscale is the source of truth for both token counts and cost (it parses
 * every provider's native session logs and prices them via LiteLLM), so this
 * module deliberately contains NO per-provider parsing and NO pricing table.
 * It only normalizes tokscale's already-aggregated output.
 *
 * The exact JSON field names tokscale emits can vary by version, so extraction
 * is alias-tolerant.
 */

import type { ProviderName } from "../types/provider"
import type { UsageEvent } from "../types/events"

/**
 * A cumulative usage snapshot (running totals for a session), or - after
 * diffing two snapshots - the usage attributable to a single turn.
 */
export interface CumulativeUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  totalTokens: number
  /** Cost in USD. May be 0 when the provider is not priceable. */
  costUSD: number
  /** Whether tokscale reported a cost at all (vs. an absent/zero cost). */
  hasCost: boolean
  /** Model id, when a single model is represented. */
  model?: string
}

/**
 * Map an SDK provider name to the tokscale `--client` id.
 *
 * Returns null for providers tokscale cannot price per-token:
 * - eliza: custom agent, not tracked by tokscale.
 *
 * (copilot is intentionally still mapped: tokscale can surface its data even
 * though it is premium-request based; the caller decides what to do with a
 * cost-less result.)
 */
export function providerToTokscaleClient(provider: string): string | null {
  const map: Partial<Record<ProviderName, string>> = {
    claude: "claude",
    codex: "codex",
    copilot: "copilot",
    gemini: "gemini",
    goose: "goose",
    kilo: "kilo",
    opencode: "opencode",
    pi: "pi",
    // eliza: intentionally omitted -> unsupported
  }
  return map[provider as ProviderName] ?? null
}

function emptyUsage(): CumulativeUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    costUSD: 0,
    hasCost: false,
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

/** Read the first numeric value among the given keys (alias-tolerant). */
function num(obj: Record<string, unknown>, keys: string[]): number | undefined {
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === "number" && Number.isFinite(v)) return v
    if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)))
      return Number(v)
  }
  return undefined
}

/** Read the first string value among the given keys. */
function str(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === "string" && v.trim() !== "") return v
  }
  return undefined
}

const INPUT_KEYS = ["inputTokens", "input_tokens", "input", "promptTokens", "prompt_tokens"]
const OUTPUT_KEYS = [
  "outputTokens",
  "output_tokens",
  "output",
  "completionTokens",
  "completion_tokens",
]
const CACHE_READ_KEYS = [
  "cacheReadTokens",
  "cache_read_tokens",
  "cacheRead",
  "cache_read",
  "cache_read_input_tokens",
  "cachedInputTokens",
  "cached_input_tokens",
]
const CACHE_WRITE_KEYS = [
  "cacheWriteTokens",
  "cache_write_tokens",
  "cacheWrite",
  "cache_write",
  "cacheCreationTokens",
  "cache_creation_tokens",
  "cache_creation_input_tokens",
]
const TOTAL_KEYS = ["totalTokens", "total_tokens", "total", "tokens"]
const COST_KEYS = ["cost", "costUSD", "cost_usd", "totalCost", "total_cost", "costUsd"]
const MODEL_KEYS = ["model", "modelId", "model_id", "modelName", "model_name"]
const SESSION_KEYS = ["sessionId", "session_id", "session", "sessionID"]

/**
 * Extract the rows array from arbitrary tokscale JSON output. tokscale may
 * return a bare array, or an object wrapping the rows under a common key.
 */
export function extractRows(parsed: unknown): Record<string, unknown>[] {
  if (Array.isArray(parsed)) return parsed.filter(isObject)
  if (!isObject(parsed)) return []
  for (const key of ["rows", "data", "results", "sessions", "items", "usage"]) {
    const v = parsed[key]
    if (Array.isArray(v)) return v.filter(isObject)
  }
  // A single-row object that itself carries token fields.
  if (num(parsed, [...TOTAL_KEYS, ...INPUT_KEYS, ...OUTPUT_KEYS]) !== undefined) {
    return [parsed]
  }
  return []
}

function rowToUsage(row: Record<string, unknown>): CumulativeUsage {
  const input = num(row, INPUT_KEYS) ?? 0
  const output = num(row, OUTPUT_KEYS) ?? 0
  const cacheRead = num(row, CACHE_READ_KEYS) ?? 0
  const cacheWrite = num(row, CACHE_WRITE_KEYS) ?? 0
  const totalRaw = num(row, TOTAL_KEYS)
  const total = totalRaw ?? input + output + cacheRead + cacheWrite
  const cost = num(row, COST_KEYS)
  return {
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    totalTokens: total,
    costUSD: cost ?? 0,
    hasCost: cost !== undefined,
    model: str(row, MODEL_KEYS),
  }
}

function addUsage(a: CumulativeUsage, b: CumulativeUsage): CumulativeUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    costUSD: a.costUSD + b.costUSD,
    hasCost: a.hasCost || b.hasCost,
    // Keep a model label when exactly one distinct model is present.
    model: a.model && b.model ? (a.model === b.model ? a.model : undefined) : a.model ?? b.model,
  }
}

/**
 * Normalize raw `tokscale --json --group-by session,model` output into a
 * cumulative usage snapshot.
 *
 * When `sessionId` is provided and any rows carry a matching session id, only
 * those rows are summed (precise per-session attribution). Otherwise all rows
 * are summed - correct for per-chat sandboxes whose native logs hold a single
 * session.
 */
export function normalizeTokscaleUsage(
  raw: string,
  sessionId?: string | null
): CumulativeUsage {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return emptyUsage()
  }
  const rows = extractRows(parsed)
  if (rows.length === 0) return emptyUsage()

  let selected = rows
  if (sessionId) {
    const matching = rows.filter((r) => str(r, SESSION_KEYS) === sessionId)
    if (matching.length > 0) selected = matching
  }

  return selected.map(rowToUsage).reduce(addUsage, emptyUsage())
}

/**
 * Subtract a baseline cumulative snapshot from a current one to obtain a single
 * turn's usage. Negative components are clamped to 0 (defends against tokscale
 * re-pricing older rows between polls).
 */
export function diffUsage(
  current: CumulativeUsage,
  baseline?: CumulativeUsage
): CumulativeUsage {
  const base = baseline ?? emptyUsage()
  const clamp = (n: number) => (n > 0 ? n : 0)
  return {
    inputTokens: clamp(current.inputTokens - base.inputTokens),
    outputTokens: clamp(current.outputTokens - base.outputTokens),
    cacheReadTokens: clamp(current.cacheReadTokens - base.cacheReadTokens),
    cacheWriteTokens: clamp(current.cacheWriteTokens - base.cacheWriteTokens),
    totalTokens: clamp(current.totalTokens - base.totalTokens),
    costUSD: clamp(current.costUSD - base.costUSD),
    hasCost: current.hasCost,
    model: current.model,
  }
}

/** Build a wire `UsageEvent` from a per-turn usage delta. */
export function usageToEvent(provider: string, usage: CumulativeUsage): UsageEvent {
  return {
    type: "usage",
    provider,
    model: usage.model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    totalTokens: usage.totalTokens,
    costUSD: usage.hasCost ? usage.costUSD : undefined,
    source: "tokscale",
  }
}
