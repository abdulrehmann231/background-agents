/**
 * GitHub Copilot CLI output parser
 *
 * Parses JSONL events from `copilot -p "..." --output-format=json --silent`.
 * Handles both naming conventions found in different CLI versions:
 *   - message.delta / assistant.message_delta  → TokenEvent
 *   - tool.call / tool.start                   → ToolStartEvent
 *   - tool.result / tool.end                   → ToolEndEvent
 *   - turn.end / assistant.turn_end            → EndEvent
 *   - session.start                            → SessionEvent
 */

import type { Event } from "../../types/events"
import { createToolStartEvent } from "../../core/tools"
import { safeJsonParse } from "../../utils/json"

/**
 * Raw event shapes from the Copilot CLI JSONL stream.
 * The `type` field is the discriminator.
 */
interface CopilotBaseEvent {
  type: string
  [key: string]: unknown
}

interface CopilotSessionStart extends CopilotBaseEvent {
  type: "session.start"
  sessionId?: string
}

interface CopilotMessageDelta extends CopilotBaseEvent {
  type: "message.delta" | "assistant.message_delta"
  content?: string
  deltaContent?: string
  role?: string
}

interface CopilotToolCall extends CopilotBaseEvent {
  type: "tool.call" | "tool.start"
  name?: string
  arguments?: Record<string, unknown>
  callId?: string
}

interface CopilotToolResult extends CopilotBaseEvent {
  type: "tool.result" | "tool.end"
  callId?: string
  result?: string
  output?: string
  is_error?: boolean
}

interface CopilotTurnEnd extends CopilotBaseEvent {
  type: "turn.end" | "assistant.turn_end"
  status?: string
  error?: string | { message: string }
}

interface CopilotSessionShutdown extends CopilotBaseEvent {
  type: "session.shutdown"
}

type CopilotEvent =
  | CopilotSessionStart
  | CopilotMessageDelta
  | CopilotToolCall
  | CopilotToolResult
  | CopilotTurnEnd
  | CopilotSessionShutdown
  | CopilotBaseEvent

/**
 * Parse a single JSONL line from the Copilot CLI.
 */
export function parseCopilotLine(
  line: string,
  toolMappings: Record<string, string>
): Event | null {
  const json = safeJsonParse<CopilotEvent>(line)
  if (!json || !json.type) return null

  // ─── Session start ────────────────────────────────────────
  if (json.type === "session.start") {
    const ev = json as CopilotSessionStart
    return { type: "session", id: ev.sessionId ?? "" }
  }

  // ─── Text streaming (both naming conventions) ─────────────
  if (json.type === "message.delta" || json.type === "assistant.message_delta") {
    const ev = json as CopilotMessageDelta
    const text = ev.content ?? ev.deltaContent ?? ""
    if (!text) return null
    return { type: "token", text }
  }

  // ─── Tool invocation start ────────────────────────────────
  if (json.type === "tool.call" || json.type === "tool.start") {
    const ev = json as CopilotToolCall
    const name = ev.name ?? "unknown"
    return createToolStartEvent(name, ev.arguments, toolMappings)
  }

  // ─── Tool result ──────────────────────────────────────────
  if (json.type === "tool.result" || json.type === "tool.end") {
    const ev = json as CopilotToolResult
    const output = ev.result ?? ev.output
    return { type: "tool_end", output }
  }

  // ─── Turn / agent loop complete ───────────────────────────
  if (json.type === "turn.end" || json.type === "assistant.turn_end") {
    const ev = json as CopilotTurnEnd
    let error: string | undefined
    if (ev.status && ev.status !== "success") {
      if (typeof ev.error === "string") {
        error = ev.error
      } else if (ev.error && typeof ev.error === "object" && "message" in ev.error) {
        error = ev.error.message
      } else {
        error = `Turn ended with status: ${ev.status}`
      }
    }
    return { type: "end", error }
  }

  // ─── Session shutdown ─────────────────────────────────────
  if (json.type === "session.shutdown") {
    return { type: "end" }
  }

  // Unknown event type — ignore gracefully
  return null
}
