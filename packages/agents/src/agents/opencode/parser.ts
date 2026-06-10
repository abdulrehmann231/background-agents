/**
 * OpenCode CLI output parser
 *
 * Pure function for parsing OpenCode CLI JSON output.
 * Note: OpenCode requires stateful parsing to track session ID.
 */

import type { Event } from "../../types/events"
import type { ParseContext } from "../../core/agent"
import { createToolStartEvent, normalizeToolName } from "../../core/tools"
import { buildUsageEvent } from "../../core/pricing"
import { safeJsonParse } from "../../utils/json"
import { resolveAgentError } from "../../utils/errors"

/**
 * Raw event types from OpenCode's JSON stream
 */
interface OpenCodeStepStart {
  type: "step_start"
  sessionID: string
  part?: {
    id: string
    sessionID: string
    messageID: string
    type: "step-start"
  }
}

interface OpenCodeText {
  type: "text"
  sessionID: string
  part?: {
    id: string
    sessionID: string
    messageID: string
    type: "text"
    text?: string
  }
}

interface OpenCodeToolCall {
  type: "tool_call"
  sessionID: string
  part?: {
    id: string
    type: "tool-call"
    tool?: string
    args?: unknown
  }
}

interface OpenCodeToolUse {
  type: "tool_use"
  sessionID: string
  part?: {
    id: string
    tool?: string
    state?: { status: string; input?: unknown }
  }
}

interface OpenCodeToolResult {
  type: "tool_result"
  sessionID: string
  part?: {
    id: string
    type: "tool-result"
  }
}

interface OpenCodeStepFinish {
  type: "step_finish"
  sessionID: string
  part?: {
    id: string
    type: "step-finish"
    reason: string
    /** USD cost for this step (authoritative — OpenCode computes it). */
    cost?: number
    tokens?: {
      input?: number
      output?: number
      reasoning?: number
      cache?: { read?: number; write?: number }
    }
  }
}

interface OpenCodeError {
  type: "error"
  sessionID: string
  error?: {
    name: string
    data?: {
      message: string
    }
  }
}

type OpenCodeEvent =
  | OpenCodeStepStart
  | OpenCodeText
  | OpenCodeToolCall
  | OpenCodeToolUse
  | OpenCodeToolResult
  | OpenCodeStepFinish
  | OpenCodeError

/**
 * Parse a line of OpenCode CLI output into event(s).
 *
 * Uses context.state.seenSessionId to track if session event was already emitted.
 */
export function parseOpencodeLine(
  line: string,
  toolMappings: Record<string, string>,
  context: ParseContext
): Event | Event[] | null {
  const json = safeJsonParse<OpenCodeEvent>(line)
  if (!json) {
    return null
  }

  // Step start - session initialization
  if (json.type === "step_start") {
    // OpenCode can emit multiple step_start lines for the same session; only emit once
    if (context.sessionId === json.sessionID) return null
    context.sessionId = json.sessionID
    return { type: "session", id: json.sessionID }
  }

  // Text content - the actual response
  if (json.type === "text") {
    if (json.part?.type === "text" && json.part.text) {
      return { type: "token", text: json.part.text }
    }
    return null
  }

  // Tool call start
  if (json.type === "tool_call") {
    const toolName = (json.part?.tool || "unknown").toLowerCase()
    const normalized = normalizeToolName(toolName, toolMappings)
    return createToolStartEvent(normalized, json.part?.args, toolMappings)
  }

  // Tool use (stream-json: emitted when tool completes with full state)
  if (json.type === "tool_use") {
    const toolName = (json.part?.tool || "unknown").toLowerCase()
    const normalized = normalizeToolName(toolName, toolMappings)
    const raw = json.part as { state?: { status?: string; input?: unknown; output?: string } } | undefined
    const startEvent = createToolStartEvent(normalized, raw?.state?.input, toolMappings)

    // If the tool already completed (state.output is present), emit tool_end inline.
    // This is the common case for OpenCode: tool_use carries the full result.
    const rawOutput = raw?.state?.output
    if (typeof rawOutput === "string" && rawOutput.trim()) {
      return [startEvent, { type: "tool_end", output: rawOutput.trim() }]
    }
    return startEvent
  }

  // Tool result - tool completed (streaming / in-progress path, no output here)
  if (json.type === "tool_result") {
    return { type: "tool_end" }
  }

  // Step finish - carries per-step token usage + an authoritative USD cost.
  // OpenCode reports usage incrementally (one step_finish per step), so emit a
  // usage event each time; summing them yields the turn total. End is emitted
  // only when the run actually stops.
  if (json.type === "step_finish") {
    const part = json.part
    const tokens = part?.tokens
    let usageEvent: Event | undefined
    if (tokens) {
      usageEvent = buildUsageEvent({
        provider: "opencode",
        // reasoning tokens are billed as output; fold them in.
        inputTokens: tokens.input ?? 0,
        outputTokens: (tokens.output ?? 0) + (tokens.reasoning ?? 0),
        cachedInputTokens: tokens.cache?.read,
        costUsd: part?.cost,
      })
    }
    if (part?.reason === "stop") {
      return usageEvent ? [usageEvent, { type: "end" }] : { type: "end" }
    }
    return usageEvent ?? null
  }

  // Error event - emit as end with error
  if (json.type === "error") {
    return { type: "end", error: resolveAgentError(json.error ?? json, "opencode") }
  }

  return null
}
