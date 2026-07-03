/**
 * Droid (Factory) CLI output parser
 *
 * `droid exec --output-format stream-json` emits droid's OWN newline-delimited
 * JSON — NOT the Claude-shaped envelopes we first assumed. Shapes captured from
 * real runs:
 *   {"type":"system","subtype":"init","session_id":…,"model":…,"tools":[…]}
 *   {"type":"message","role":"user"|"assistant","text":…,…}
 *   {"type":"reasoning","text":…,…}                      // internal thinking
 *   {"type":"tool_call","toolName":…,"parameters":{…},…}
 *   {"type":"tool_result","toolId":…,"isError":bool,"value":…,…}
 *   {"type":"completion","finalText":…,"usage":{…},…}    // successful end
 *
 * A fatal failure is emitted as a distinct `{"type":"error", …}` event (e.g. bad
 * key / auth), which we surface as a classified end-error. We also keep a
 * plain-text `error:` fallback for the rare non-JSON error line.
 */

import type { Event } from "../../types/events"
import { createToolStartEvent, stringifyToolResult } from "../../core/tools"
import { safeJsonParse } from "../../utils/json"
import { resolveAgentError } from "../../utils/errors"

/** Matches droid's plain-text fatal error line (`error: <detail>`). */
const DROID_ERROR_LINE = /^error:\s*(.+)$/i

interface DroidEvent {
  type?: string
  subtype?: string
  role?: string
  text?: string
  finalText?: string
  session_id?: string
  toolName?: string
  parameters?: unknown
  value?: unknown
  message?: string
  error?: string
}

export function parseDroidLine(
  line: string,
  toolMappings: Record<string, string>
): Event | Event[] | null {
  const json = safeJsonParse<DroidEvent>(line)
  if (!json) {
    // Non-JSON line: the only ones we care about are droid's plain-text errors.
    const m = DROID_ERROR_LINE.exec(line.trim())
    if (m) return { type: "end", error: resolveAgentError(m[1], "droid") }
    return null
  }

  switch (json.type) {
    // Session id for resumption.
    case "system":
      if (json.subtype === "init" && json.session_id) {
        return { type: "session", id: json.session_id }
      }
      return null

    // Assistant text is a token; the echoed user prompt is ignored. Internal
    // `reasoning` is dropped (matches how the Claude parser drops thinking).
    case "message":
      if (json.role === "assistant" && json.text) {
        return { type: "token", text: json.text }
      }
      return null

    case "tool_call":
      if (json.toolName) {
        return createToolStartEvent(json.toolName, json.parameters, toolMappings)
      }
      return null

    case "tool_result":
      return { type: "tool_end", output: stringifyToolResult(json.value) }

    // Successful end. `completion.finalText` is NOT new text — it's a verbatim
    // echo of the assistant `message` events we already streamed (verified against
    // real fixtures: finalText is always a substring of the concatenated messages).
    // Emitting it again duplicates the whole reply in the UI, so we drop it and
    // just end the turn.
    case "completion":
      return { type: "end" }

    // droid's fatal-error event — surface it as a classified end-error.
    case "error": {
      const detail = json.message ?? json.error ?? json
      return { type: "end", error: resolveAgentError(detail, "droid") }
    }

    default:
      return null
  }
}
