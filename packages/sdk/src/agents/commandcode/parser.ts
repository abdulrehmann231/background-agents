/**
 * Command Code CLI output parser
 *
 * `cmd -p "<prompt>" --output-format json` emits newline-delimited JSON in two
 * shapes (see the CLI's bundled headless reference):
 *
 *   {"type":"event","event":{ …one AgentEvent… }}   ← zero or more, in order
 *   {"type":"result","subtype":"success",…}          ← exactly one, always last
 *
 * The AgentEvent frames we consume:
 *   run_start     {sessionId}                        ← the resumable session id
 *   text_delta    {delta}                            ← streamed assistant text
 *   tool_queued   {toolCallId,toolName,input}        ← the only frame with input
 *   tool_completed{toolCallId,toolName,result}
 *   tool_errored  {toolCallId,toolName,error}
 *   tool_denied   {toolCallId,toolName}              ← permission engine refusal
 *   run_error     {error:{name,message}}             ← see below
 *
 * Everything else (thinking_*, model_request_*, message_end, turn_start,
 * notice, todo/task frames, …) is dropped: message_end and the result line's
 * `finalText` re-state text we already streamed as text_delta, and emitting
 * them again would duplicate the whole reply.
 *
 * Failure handling. A mid-run failure (provider error, bad key, no credits) is
 * emitted as a `run_error` frame, but the run still ends with
 * `subtype:"success"` and `stopReason:"run_error"` — the detail never reaches
 * the result line, only stderr. So we stash the `run_error` detail on the parse
 * context and attach it to the `end` we emit for the result line. Without that,
 * a failed turn would end silently with no output and no reason.
 */

import type { Event } from "../../types/events"
import type { ParseContext } from "../../core/agent"
import { createToolStartEvent, stringifyToolResult } from "../../core/tools"
import { safeJsonParse } from "../../utils/json"
import { resolveAgentError } from "../../utils/errors"

/** Parse-context key holding the `run_error` detail until the result line. */
const RUN_ERROR_KEY = "commandCodeRunError"

/** Exit reason the CLI reports when the agent loop died mid-run. */
const RUN_ERROR_STOP_REASON = "run_error"

interface CommandCodeAgentEvent {
  type?: string
  /** run_start */
  sessionId?: string
  /** text_delta */
  delta?: string
  /** tool_* */
  toolName?: string
  input?: unknown
  result?: unknown
  /** tool_errored / run_error */
  error?: unknown
}

interface CommandCodeLine {
  type?: "event" | "result"
  /** type: "event" */
  event?: CommandCodeAgentEvent
  /** type: "result" */
  subtype?: "success" | "error" | "max_turns"
  sessionId?: string
  stopReason?: string
  error?: unknown
}

/** Read (and clear) the stashed `run_error` detail, if any. */
function takeRunError(context: ParseContext): unknown {
  const pending = context.state[RUN_ERROR_KEY]
  delete context.state[RUN_ERROR_KEY]
  return pending
}

function parseAgentEvent(
  event: CommandCodeAgentEvent,
  toolMappings: Record<string, string>,
  context: ParseContext
): Event | Event[] | null {
  switch (event.type) {
    // Carries the session id `--resume` takes on the next turn.
    case "run_start":
      return event.sessionId ? { type: "session", id: event.sessionId } : null

    case "text_delta":
      return event.delta ? { type: "token", text: event.delta } : null

    // tool_queued is emitted once per tool call with its input; the later
    // tool_running frame repeats the name without the input, so ignore that one.
    case "tool_queued":
      return event.toolName
        ? createToolStartEvent(event.toolName, event.input, toolMappings)
        : null

    case "tool_completed":
      return { type: "tool_end", output: stringifyToolResult(event.result) }

    case "tool_errored":
      return { type: "tool_end", output: stringifyToolResult(event.error) }

    // The permission engine refused the call: no result ever arrives, so close
    // the tool card here or the UI leaves it spinning for the rest of the turn.
    case "tool_denied":
      return { type: "tool_end", output: "Tool call denied" }

    // Stash, don't emit: the run continues to its result line (see the header).
    case "run_error":
      context.state[RUN_ERROR_KEY] = event.error ?? event
      return null

    default:
      return null
  }
}

function parseResultLine(
  line: CommandCodeLine,
  context: ParseContext
): Event | Event[] {
  const events: Event[] = []
  if (line.sessionId && context.sessionId !== line.sessionId) {
    events.push({ type: "session", id: line.sessionId })
  }

  const runError = takeRunError(context)
  const failed = line.subtype === "error" || line.stopReason === RUN_ERROR_STOP_REASON
  if (failed) {
    const detail = line.error ?? runError ?? "Command Code run failed"
    events.push({ type: "end", error: resolveAgentError(detail, "commandcode") })
  } else if (line.subtype === "max_turns") {
    events.push({
      type: "end",
      error:
        "Command Code stopped after reaching its maximum number of turns without finishing. Send a follow-up to continue.",
    })
  } else {
    events.push({ type: "end" })
  }

  return events.length === 1 ? events[0] : events
}

export function parseCommandCodeLine(
  line: string,
  toolMappings: Record<string, string>,
  context: ParseContext
): Event | Event[] | null {
  const json = safeJsonParse<CommandCodeLine>(line)
  // Non-JSON lines are the CLI's own stderr/progress chatter — nothing to do.
  if (!json) return null

  if (json.type === "event") {
    return json.event ? parseAgentEvent(json.event, toolMappings, context) : null
  }

  if (json.type === "result") return parseResultLine(json, context)

  return null
}
