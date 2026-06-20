/**
 * OpenCode CLI output parser
 *
 * Pure function for parsing OpenCode CLI JSON output.
 * Note: OpenCode requires stateful parsing to track session ID.
 */

import type { Event } from "../../types/events"
import type { ParseContext } from "../../core/agent"
import { createToolStartEvent, normalizeToolName } from "../../core/tools"
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
 * Detect a fatal model-call failure from OpenCode's plaintext ERROR logs.
 *
 * Why this exists: on a retryable model error (HTTP 429 rate-limit / usage
 * limit, overloaded, transient network), OpenCode does NOT emit a JSON `error`
 * event — it silently retries with unbounded exponential backoff, writing only
 * a plaintext `ERROR … service=llm … error={…}` line to its logs on each
 * attempt. With nothing on stdout, the turn never ends and the UI spins on the
 * "generating" indicator forever. We surface the failure instead (matching how
 * the Claude agent surfaces a limit), so the user sees the error and can retry.
 *
 * Lines look like:
 *   ERROR 2026-… +Nms service=llm providerID=anthropic modelID=… session.id=…
 *   error={"error":{"name":"AI_APICallError","cause":{"code":"…"},…,"statusCode":429,…}}
 *
 * The `error={…}` blob also embeds the full request body (system prompt, tool
 * defs), so we avoid JSON.parsing it and pull only the high-signal fields by
 * regex. We require TWO such lines before terminating: the first gives OpenCode
 * one retry to recover from a transient blip; a second failure means it's stuck.
 */
function parseOpencodeLogError(line: string, context: ParseContext): Event | null {
  // Only model-call (service=llm) ERROR logs. Tool/bash errors are recoverable
  // and must not end the turn.
  if (!/^ERROR\b/.test(line) || !/\bservice=llm\b/.test(line)) return null

  const count = ((context.state.llmErrorCount as number) ?? 0) + 1
  context.state.llmErrorCount = count

  // Grace: tolerate a single failure (OpenCode will retry); act on the second.
  if (count < 2 || context.state.llmErrorEmitted) return null
  context.state.llmErrorEmitted = true

  // High-signal fields from the `error={…}` JSON, by regex (no full parse).
  const name = line.match(/error=\{"error":\{"name":"([^"]+)"/)?.[1]
  const status = line.match(/"statusCode":\s*(\d+)/)?.[1]
  const causeCode = line.match(/"cause":\{[^}]*"code":"([^"]+)"/)?.[1]
  const parts = [name, status ? `HTTP ${status}` : null, causeCode].filter(Boolean)
  const raw = parts.join(" ") || "the model request failed repeatedly"

  return { type: "end", error: resolveAgentError(raw, "opencode") }
}

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
    // Non-JSON line: OpenCode's plaintext logs. A repeated model-call failure
    // here is the only signal during an otherwise-silent retry hang.
    return parseOpencodeLogError(line, context)
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

  // Step finish - emit end only when run actually stops
  if (json.type === "step_finish") {
    if (json.part?.reason === "stop") return { type: "end" }
    return null
  }

  // Error event - emit as end with error
  if (json.type === "error") {
    return { type: "end", error: resolveAgentError(json.error ?? json, "opencode") }
  }

  return null
}
