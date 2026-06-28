/**
 * Parser tests for parseCodexLine - pure data transformations from the agent's
 * event format to our standard Event format. No mocks, no I/O.
 */
import { describe, it, expect } from "vitest"
import { parseCodexLine, CODEX_TOOL_MAPPINGS } from "../../src/agents/index.js"

describe("parseCodexLine", () => {
  const mappings = CODEX_TOOL_MAPPINGS

  it("returns null for invalid JSON", () => {
    expect(parseCodexLine("not json", mappings)).toBeNull()
    expect(parseCodexLine("", mappings)).toBeNull()
  })

  it("parses thread.started event", () => {
    const event = parseCodexLine(
      '{"type": "thread.started", "thread_id": "thread_abc"}',
      mappings
    )
    expect(event).toEqual({ type: "session", id: "thread_abc" })
  })

  it("parses item.message.delta event", () => {
    const event = parseCodexLine(
      '{"type": "item.message.delta", "text": "Hello"}',
      mappings
    )
    expect(event).toEqual({ type: "token", text: "Hello" })
  })

  it("parses item.tool.start event", () => {
    const event = parseCodexLine(
      '{"type": "item.tool.start", "name": "shell"}',
      mappings
    )
    expect(event).toEqual({ type: "tool_start", name: "shell", input: {} })
  })

  it("parses item.tool.input.delta event", () => {
    const event = parseCodexLine(
      '{"type": "item.tool.input.delta", "text": "ls -la"}',
      mappings
    )
    expect(event).toEqual({ type: "tool_delta", text: "ls -la" })
  })

  it("parses item.tool.end event", () => {
    const event = parseCodexLine('{"type": "item.tool.end"}', mappings)
    expect(event).toEqual({ type: "tool_end" })
  })

  it("parses turn.completed event", () => {
    const event = parseCodexLine('{"type": "turn.completed"}', mappings)
    expect(event).toEqual({ type: "end" })
  })

  it("parses turn.failed event with error", () => {
    const event = parseCodexLine(
      '{"type": "turn.failed", "error": {"message": "API rate limit exceeded"}}',
      mappings
    )
    expect(event).toEqual({
      type: "end",
      error: "API rate limit exceeded — wait a moment and retry",
    })
  })

  it("parses error event with message", () => {
    const event = parseCodexLine(
      '{"type": "error", "message": "unexpected status 401 Unauthorized"}',
      mappings
    )
    expect(event).toEqual({
      type: "end",
      error: "unexpected status 401 Unauthorized — check the API key for this model in Settings",
    })
  })

  it("returns null for unknown event types", () => {
    expect(parseCodexLine('{"type": "unknown.event"}', mappings)).toBeNull()
  })
})

