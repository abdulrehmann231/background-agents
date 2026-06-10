/**
 * Token → cost estimation.
 *
 * Some providers report cost directly in their stream (Claude `total_cost_usd`,
 * OpenCode/Kilo `cost`). Others (Codex, Gemini) report only token counts. For
 * those, this module estimates USD cost from a small static price table so the
 * `usage` event can still carry a `costUsd` for budgeting / "about to hit limit"
 * decisions.
 *
 * Prices are USD per 1M tokens and intentionally approximate — they exist to
 * power relative budgeting, not billing. The table is matched by substring so a
 * dated model id (e.g. "gpt-5.5-2026-01") still resolves to its family. Keep the
 * canonical pricing source (LiteLLM `model_prices_and_context_window.json` /
 * OpenRouter) in mind when refreshing these numbers.
 */

import type { UsageEvent } from "../types/events"

export interface ModelPrice {
  /** USD per 1M non-cached input tokens. */
  input: number
  /** USD per 1M output tokens. */
  output: number
  /** USD per 1M cached (cache-read) input tokens. Defaults to input when absent. */
  cachedInput?: number
}

export interface UsageTokens {
  inputTokens: number
  outputTokens: number
  cachedInputTokens?: number
}

/**
 * Substring → price table. Order matters: the first key that appears in the
 * (lowercased) model id wins, so list more specific ids before their families.
 */
const PRICE_TABLE: ReadonlyArray<readonly [string, ModelPrice]> = [
  // ── OpenAI / Codex ────────────────────────────────────────────────────────
  ["gpt-5.5", { input: 1.25, output: 10, cachedInput: 0.125 }],
  ["gpt-5.4-mini", { input: 0.25, output: 2, cachedInput: 0.025 }],
  ["gpt-5.4", { input: 1.25, output: 10, cachedInput: 0.125 }],
  ["gpt-5.3-codex", { input: 1.25, output: 10, cachedInput: 0.125 }],
  ["gpt-5-codex", { input: 1.25, output: 10, cachedInput: 0.125 }],
  ["gpt-5-mini", { input: 0.25, output: 2, cachedInput: 0.025 }],
  ["gpt-5-nano", { input: 0.05, output: 0.4, cachedInput: 0.005 }],
  ["gpt-5", { input: 1.25, output: 10, cachedInput: 0.125 }],
  ["gpt-4o-mini", { input: 0.15, output: 0.6, cachedInput: 0.075 }],
  ["gpt-4o", { input: 2.5, output: 10, cachedInput: 1.25 }],
  ["o4-mini", { input: 1.1, output: 4.4, cachedInput: 0.275 }],
  ["o3-mini", { input: 1.1, output: 4.4, cachedInput: 0.55 }],
  ["o3", { input: 2, output: 8, cachedInput: 0.5 }],

  // ── Google / Gemini ───────────────────────────────────────────────────────
  ["gemini-3-pro", { input: 2, output: 12, cachedInput: 0.2 }],
  ["gemini-3-flash", { input: 0.3, output: 2.5, cachedInput: 0.03 }],
  ["gemini-2.5-pro", { input: 1.25, output: 10, cachedInput: 0.31 }],
  ["gemini-2.5-flash-lite", { input: 0.1, output: 0.4, cachedInput: 0.025 }],
  ["gemini-2.5-flash", { input: 0.3, output: 2.5, cachedInput: 0.075 }],
  ["gemini", { input: 0.3, output: 2.5, cachedInput: 0.075 }],

  // ── Anthropic / Claude (fallback only — Claude reports cost directly) ──────
  ["claude-opus", { input: 5, output: 25, cachedInput: 0.5 }],
  ["claude-sonnet", { input: 3, output: 15, cachedInput: 0.3 }],
  ["claude-haiku", { input: 0.8, output: 4, cachedInput: 0.08 }],
]

/** Resolve a model id (case-insensitive substring match) to its price. */
export function getModelPrice(model: string | undefined): ModelPrice | undefined {
  if (!model) return undefined
  const m = model.toLowerCase()
  for (const [key, price] of PRICE_TABLE) {
    if (m.includes(key)) return price
  }
  return undefined
}

/**
 * Estimate USD cost for a unit of usage. Returns undefined when the model is
 * unknown to the table, so callers can distinguish "free/zero" from "unknown".
 */
export function estimateCostUsd(
  model: string | undefined,
  usage: UsageTokens
): number | undefined {
  const price = getModelPrice(model)
  if (!price) return undefined
  const cached = usage.cachedInputTokens ?? 0
  const cachedRate = price.cachedInput ?? price.input
  const cost =
    (usage.inputTokens * price.input +
      usage.outputTokens * price.output +
      cached * cachedRate) /
    1_000_000
  return cost
}

/**
 * Build a normalized {@link UsageEvent}, deriving `totalTokens` when not given
 * and estimating `costUsd` from the price table when the provider didn't report
 * a cost directly. Parsers call this so cost handling lives in one place.
 */
export function buildUsageEvent(args: {
  provider: string
  model?: string
  inputTokens: number
  outputTokens: number
  cachedInputTokens?: number
  /** Provider-reported total; computed from the parts when omitted. */
  totalTokens?: number
  /** Provider-reported cost; estimated from tokens when omitted. */
  costUsd?: number
}): UsageEvent {
  const inputTokens = args.inputTokens || 0
  const outputTokens = args.outputTokens || 0
  const cachedInputTokens = args.cachedInputTokens
  const totalTokens =
    args.totalTokens ?? inputTokens + outputTokens + (cachedInputTokens ?? 0)
  const costUsd =
    args.costUsd ??
    estimateCostUsd(args.model, { inputTokens, outputTokens, cachedInputTokens })
  return {
    type: "usage",
    provider: args.provider,
    model: args.model,
    inputTokens,
    outputTokens,
    ...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
    totalTokens,
    ...(costUsd !== undefined ? { costUsd } : {}),
  }
}
