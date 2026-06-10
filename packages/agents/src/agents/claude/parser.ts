/**
 * Claude CLI output parser
 *
 * Pure function for parsing Claude CLI JSON output.
 * No state, no side effects - easily testable.
 */

import type { Event } from "../../types/events"
import { createToolStartEvent } from "../../core/tools"
import { buildUsageEvent } from "../../core/pricing"
import { safeJsonParse } from "../../utils/json"
import { resolveAgentError } from "../../utils/errors"

/**
 * Raw event types from Claude CLI's stream-json output
 */
interface ClaudeSystemInit {
  type: "system"
  subtype: "init"
  session_id: string
}

interface ClaudeAssistantMessage {
  type: "assistant"
  message: {
    id: string
    content: Array<{
      type: "text" | "tool_use"
      text?: string
      name?: string
      input?: unknown
    }>
  }
  session_id: string
}

interface ClaudeUsage {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

interface ClaudeResult {
  type: "result"
  subtype?: "success" | "error" | "error_during_execution" | "error_max_turns"
  /** Authoritative failure flag. Set true for subscription session/usage-limit
   *  results, which otherwise arrive with subtype "success" and the limit
   *  notice in `result` — so checking subtype alone misses them. */
  is_error?: boolean
  result?: string
  error?: string
  session_id: string
  /** Final cumulative token usage for the turn. */
  usage?: ClaudeUsage
  /** Authoritative USD cost for the whole turn (sums all models used). */
  total_cost_usd?: number
  /** Per-model breakdown; keys are model ids. Used to label the usage event. */
  modelUsage?: Record<string, unknown>
}

interface ClaudeToolUse {
  type: "tool_use"
  name: string
  input?: unknown
}

interface ClaudeToolResult {
  type: "tool_result"
  tool_use_id: string
  result?: string
  content?: string | Array<{ type: string; text?: string }>
}

interface ClaudeUserMessage {
  type: "user"
  message?: {
    content?: Array<{
      type: string
      tool_use_id?: string
      content?: string | Array<{ type: string; text?: string }>
    }>
  }
}

type ClaudeEvent =
  | ClaudeSystemInit
  | ClaudeAssistantMessage
  | ClaudeUserMessage
  | ClaudeResult
  | ClaudeToolUse
  | ClaudeToolResult

/**
 * Extract output from a tool result object
 */
function toolResultOutput(obj: ClaudeToolResult): string | undefined {
  let out = obj.result
  if (out === undefined && obj.content !== undefined) {
    if (typeof obj.content === "string") out = obj.content
    else if (Array.isArray(obj.content) && obj.content[0]?.text)
      out = obj.content[0].text
  }
  return out
}

/**
 * Parse a line of Claude CLI output into event(s).
 *
 * @param line - Raw line from CLI output
 * @param toolMappings - Tool name mappings for this agent
 * @returns Event, array of events, or null if line should be ignored
 */
export function parseClaudeLine(
  line: string,
  toolMappings: Record<string, string>
): Event | Event[] | null {
  const json = safeJsonParse<ClaudeEvent>(line)
  if (!json) {
    return null
  }

  // System init event contains session ID
  if (json.type === "system" && "subtype" in json && json.subtype === "init") {
    return { type: "session", id: json.session_id }
  }

  // Assistant message contains the response content
  if (json.type === "assistant" && "message" in json) {
    const content = json.message.content
    if (content && content.length > 0) {
      // Find text content and emit as token
      for (const block of content) {
        if (block.type === "text" && block.text) {
          return { type: "token", text: block.text }
        }
        if (block.type === "tool_use" && block.name) {
          return createToolStartEvent(block.name, block.input, toolMappings)
        }
      }
    }
    return null
  }

  // Tool use event
  if (json.type === "tool_use" && "name" in json) {
    return createToolStartEvent(json.name, json.input, toolMappings)
  }

  // Tool result (standalone)
  if (json.type === "tool_result") {
    return { type: "tool_end", output: toolResultOutput(json) }
  }

  // Tool result inside user message
  if (json.type === "user" && json.message?.content) {
    for (const block of json.message.content) {
      if (block.type === "tool_result") {
        let out: string | undefined
        if (typeof block.content === "string") out = block.content
        else if (Array.isArray(block.content) && block.content[0]?.text)
          out = block.content[0].text
        return { type: "tool_end", output: out }
      }
    }
  }

  // Result event marks end of interaction (success or CLI error)
  if (json.type === "result") {
    const res = json as ClaudeResult
    const isError =
      res.is_error === true ||
      res.subtype === "error_during_execution" ||
      res.subtype === "error"
    const err = isError
      ? resolveAgentError(res.error ?? res.result ?? json, "claude")
      : undefined
    const endEvent: Event = { type: "end", ...(err ? { error: err } : {}) }

    // Claude reports cumulative usage + an authoritative USD cost on the result
    // line. Emit a usage event before end so consumers can budget per turn.
    if (res.usage) {
      const model = res.modelUsage ? Object.keys(res.modelUsage)[0] : undefined
      const usageEvent = buildUsageEvent({
        provider: "claude",
        model,
        inputTokens: res.usage.input_tokens ?? 0,
        outputTokens: res.usage.output_tokens ?? 0,
        cachedInputTokens: res.usage.cache_read_input_tokens,
        costUsd: res.total_cost_usd,
      })
      return [usageEvent, endEvent]
    }
    return endEvent
  }

  return null
}
