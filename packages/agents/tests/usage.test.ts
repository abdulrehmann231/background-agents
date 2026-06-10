/**
 * Usage-event emission, cost estimation, and provider-limit classification.
 *
 * Fixture lines mirror the real shapes in tests/fixtures/jsonl-reference/*.jsonl.
 */
import { describe, it, expect } from "vitest"
import {
  parseClaudeLine,
  parseCodexLine,
  parseGeminiLine,
  parseOpencodeLine,
  CLAUDE_TOOL_MAPPINGS,
  CODEX_TOOL_MAPPINGS,
  GEMINI_TOOL_MAPPINGS,
  OPENCODE_TOOL_MAPPINGS,
} from "../src/agents/index.js"
import {
  estimateCostUsd,
  getModelPrice,
  buildUsageEvent,
} from "../src/core/pricing.js"
import { classifyAgentError, isSwitchWorthyError } from "../src/utils/errors.js"
import type { ParseContext } from "../src/core/agent.js"
import type { UsageEvent } from "../src/types/events.js"

function createContext(): ParseContext {
  return { state: {}, sessionId: null }
}

/** Pull the single usage event out of a parser result (array or scalar). */
function usageOf(result: unknown): UsageEvent {
  const arr = Array.isArray(result) ? result : [result]
  const usage = arr.find((e) => (e as { type?: string })?.type === "usage")
  expect(usage, "expected a usage event").toBeTruthy()
  return usage as UsageEvent
}

describe("usage emission — claude", () => {
  it("emits usage with provider-reported cost from the result line", () => {
    const line = JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      num_turns: 4,
      session_id: "s1",
      total_cost_usd: 0.0455704,
      usage: {
        input_tokens: 18,
        cache_creation_input_tokens: 5252,
        cache_read_input_tokens: 69608,
        output_tokens: 298,
      },
      modelUsage: { "claude-sonnet-4-5-20250929": {} },
    })
    const result = parseClaudeLine(line, CLAUDE_TOOL_MAPPINGS)
    expect(Array.isArray(result)).toBe(true)
    const u = usageOf(result)
    expect(u.provider).toBe("claude")
    expect(u.model).toBe("claude-sonnet-4-5-20250929")
    expect(u.inputTokens).toBe(18)
    expect(u.outputTokens).toBe(298)
    expect(u.cachedInputTokens).toBe(69608)
    // Provider cost wins over any estimate.
    expect(u.costUsd).toBeCloseTo(0.0455704, 6)
    // end still follows.
    expect((result as unknown[]).at(-1)).toEqual({ type: "end" })
  })

  it("still ends cleanly when the result carries no usage", () => {
    const line = JSON.stringify({ type: "result", subtype: "success", session_id: "s1" })
    expect(parseClaudeLine(line, CLAUDE_TOOL_MAPPINGS)).toEqual({ type: "end" })
  })
})

describe("usage emission — codex", () => {
  it("splits cached tokens out of OpenAI's inclusive input_tokens", () => {
    const line = JSON.stringify({
      type: "turn.completed",
      usage: { input_tokens: 20643, cached_input_tokens: 10240, output_tokens: 239 },
    })
    const u = usageOf(parseCodexLine(line, CODEX_TOOL_MAPPINGS))
    expect(u.provider).toBe("codex")
    expect(u.inputTokens).toBe(20643 - 10240) // non-cached
    expect(u.cachedInputTokens).toBe(10240)
    expect(u.outputTokens).toBe(239)
    // Model isn't in the codex stream → cost left for the caller to estimate.
    expect(u.costUsd).toBeUndefined()
  })

  it("turn.completed without usage is a bare end", () => {
    expect(parseCodexLine('{"type":"turn.completed"}', CODEX_TOOL_MAPPINGS)).toEqual({
      type: "end",
    })
  })
})

describe("usage emission — gemini", () => {
  it("sums per-model cost estimates and uses non-cached input", () => {
    const line = JSON.stringify({
      type: "result",
      status: "success",
      stats: {
        total_tokens: 26880,
        input_tokens: 25439,
        output_tokens: 217,
        cached: 8111,
        input: 17328,
        models: {
          "gemini-2.5-flash-lite": { total_tokens: 3442, input: 2992, output_tokens: 77, cached: 0 },
          "gemini-3-flash-preview": { total_tokens: 23438, input: 14336, output_tokens: 140, cached: 8111 },
        },
      },
    })
    const u = usageOf(parseGeminiLine(line, GEMINI_TOOL_MAPPINGS, createContext()))
    expect(u.provider).toBe("gemini")
    expect(u.inputTokens).toBe(17328) // non-cached
    expect(u.cachedInputTokens).toBe(8111)
    expect(u.totalTokens).toBe(26880) // provider-reported total preserved
    // Highest-volume model labels the event.
    expect(u.model).toBe("gemini-3-flash-preview")
    // Cost estimated from the table (both models are known) → positive.
    expect(u.costUsd).toBeGreaterThan(0)
  })

  it("empty stats stays a bare end (no zero usage event)", () => {
    const line = JSON.stringify({ type: "result", status: "success", stats: {} })
    expect(parseGeminiLine(line, GEMINI_TOOL_MAPPINGS, createContext())).toEqual({
      type: "end",
    })
  })
})

describe("usage emission — opencode", () => {
  it("emits incremental usage per step with provider cost (non-stop step)", () => {
    const line = JSON.stringify({
      type: "step_finish",
      sessionID: "ses_1",
      part: {
        id: "p1",
        type: "step-finish",
        reason: "tool-calls",
        cost: 0.007113,
        tokens: { input: 1, output: 194, reasoning: 0, cache: { read: 12775, write: 98 } },
      },
    })
    const result = parseOpencodeLine(line, OPENCODE_TOOL_MAPPINGS, createContext())
    // Non-stop step → usage only, no end.
    expect(Array.isArray(result)).toBe(false)
    const u = result as UsageEvent
    expect(u.type).toBe("usage")
    expect(u.inputTokens).toBe(1)
    expect(u.outputTokens).toBe(194)
    expect(u.cachedInputTokens).toBe(12775)
    expect(u.costUsd).toBeCloseTo(0.007113, 6)
  })

  it("emits [usage, end] on the stop step", () => {
    const line = JSON.stringify({
      type: "step_finish",
      sessionID: "ses_1",
      part: {
        id: "p2",
        type: "step-finish",
        reason: "stop",
        cost: 0.00544365,
        tokens: { input: 1, output: 10, reasoning: 0, cache: { read: 12873, write: 381 } },
      },
    })
    const result = parseOpencodeLine(line, OPENCODE_TOOL_MAPPINGS, createContext())
    expect(Array.isArray(result)).toBe(true)
    expect((result as unknown[]).at(-1)).toEqual({ type: "end" })
    expect(usageOf(result).costUsd).toBeCloseTo(0.00544365, 6)
  })
})

describe("pricing", () => {
  it("resolves a model by substring and estimates cost", () => {
    expect(getModelPrice("gpt-5.5-2026-01")).toBeDefined()
    const cost = estimateCostUsd("gpt-5.5", {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    })
    // 1M input @ $1.25 + 1M output @ $10 = $11.25
    expect(cost).toBeCloseTo(11.25, 4)
  })

  it("returns undefined for unknown models so callers can distinguish from zero", () => {
    expect(estimateCostUsd("some-unknown-model", { inputTokens: 1000, outputTokens: 1000 })).toBeUndefined()
  })

  it("buildUsageEvent derives total and estimates cost when none supplied", () => {
    const u = buildUsageEvent({
      provider: "codex",
      model: "gpt-5-mini",
      inputTokens: 1000,
      outputTokens: 500,
      cachedInputTokens: 200,
    })
    expect(u.totalTokens).toBe(1700)
    expect(u.costUsd).toBeGreaterThan(0)
  })
})

describe("provider-limit classification", () => {
  it("classifies subscription/quota exhaustion as usage_limit", () => {
    for (const msg of [
      "Claude usage limit reached. Your limit will reset at 5pm.",
      "You have reached your weekly limit",
      "RESOURCE_EXHAUSTED: quota exceeded for this model",
      "Monthly limit reached for OpenCode Go",
    ]) {
      expect(classifyAgentError(msg).category, msg).toBe("usage_limit")
    }
  })

  it("classifies Claude Code's session-limit wording as usage_limit", () => {
    // Exact phrasing the Claude Code CLI emits on a subscription cap.
    for (const msg of [
      "You've hit your session limit · resets 11am (UTC)",
      "You've hit your session limit · resets 3pm (UTC)",
      "Session limit reached",
    ]) {
      expect(classifyAgentError(msg).category, msg).toBe("usage_limit")
      expect(isSwitchWorthyError(classifyAgentError(msg).category), msg).toBe(true)
    }
  })

  it("keeps transient throttling as rate_limit (not usage_limit)", () => {
    expect(classifyAgentError("Rate limit exceeded").category).toBe("rate_limit")
    expect(classifyAgentError("429 Too Many Requests").category).toBe("rate_limit")
  })

  it("flags a Claude result with is_error=true as an end error (limit text)", () => {
    // Claude reports the session limit as a 'success'-subtype result with
    // is_error=true and the notice in `result` — the parser must surface it as
    // an error so the web layer can switch providers.
    const line = JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: true,
      session_id: "s1",
      result: "You've hit your session limit · resets 11am (UTC)",
    })
    const out = parseClaudeLine(line, CLAUDE_TOOL_MAPPINGS)
    const end = (Array.isArray(out) ? out : [out]).find(
      (e) => (e as { type?: string })?.type === "end"
    ) as { type: "end"; error?: string } | undefined
    expect(end?.error).toBeTruthy()
    expect(classifyAgentError(end!.error!).category).toBe("usage_limit")
  })

  it("isSwitchWorthyError covers usage_limit, balance, rate_limit but not auth", () => {
    expect(isSwitchWorthyError("usage_limit")).toBe(true)
    expect(isSwitchWorthyError("balance")).toBe(true)
    expect(isSwitchWorthyError("rate_limit")).toBe(true)
    expect(isSwitchWorthyError("auth")).toBe(false)
    expect(isSwitchWorthyError("unknown")).toBe(false)
  })
})
