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

  describe("current schema (item.started / item.completed)", () => {
    it("parses item.completed agent_message as a token", () => {
      const event = parseCodexLine(
        '{"type": "item.completed", "item": {"id": "1", "type": "agent_message", "text": "Hello"}}',
        mappings
      )
      expect(event).toEqual({ type: "token", text: "Hello" })
    })

    it("parses item.started command_execution as a shell tool_start", () => {
      const event = parseCodexLine(
        '{"type": "item.started", "item": {"id": "1", "type": "command_execution", "command": "ls -la"}}',
        mappings
      )
      expect(event).toEqual({
        type: "tool_start",
        name: "shell",
        input: { command: "ls -la" },
      })
    })

    it("parses item.started file_change as a write tool_start", () => {
      const event = parseCodexLine(
        '{"type": "item.started", "item": {"id": "1", "type": "file_change"}}',
        mappings
      )
      expect(event).toEqual({ type: "tool_start", name: "write", input: {} })
    })

    it("parses item.started mcp_tool_call, mapping the tool name and passing through arguments", () => {
      const event = parseCodexLine(
        '{"type": "item.started", "item": {"id": "1", "type": "mcp_tool_call", "tool": "Read", "arguments": {"file_path": "foo.ts"}}}',
        mappings
      )
      expect(event).toEqual({
        type: "tool_start",
        name: "read",
        input: { file_path: "foo.ts" },
      })
    })

    it("parses item.completed command_execution output as tool_end", () => {
      const event = parseCodexLine(
        '{"type": "item.completed", "item": {"id": "1", "type": "command_execution", "aggregated_output": "total 0\\n"}}',
        mappings
      )
      expect(event).toEqual({ type: "tool_end", output: "total 0\n" })
    })

    it("parses item.completed mcp_tool_call result text as tool_end", () => {
      const event = parseCodexLine(
        '{"type": "item.completed", "item": {"id": "1", "type": "mcp_tool_call", "result": {"content": [{"type": "text", "text": "ok"}]}}}',
        mappings
      )
      expect(event).toEqual({ type: "tool_end", output: "ok" })
    })

    it("falls back to JSON.stringify for an mcp_tool_call result with no content", () => {
      const event = parseCodexLine(
        '{"type": "item.completed", "item": {"id": "1", "type": "mcp_tool_call", "result": {"structured_content": {"ok": true}}}}',
        mappings
      )
      expect(event).toEqual({
        type: "tool_end",
        output: JSON.stringify({ structured_content: { ok: true } }),
      })
    })

    it("parses item.completed file_change as a write tool_start followed by tool_end", () => {
      const event = parseCodexLine(
        '{"type": "item.completed", "item": {"id": "1", "type": "file_change", "changes": [{"path": "a.ts", "kind": "add"}]}}',
        mappings
      )
      expect(event).toEqual([
        {
          type: "tool_start",
          name: "write",
          input: { file_path: "a.ts", kind: "add", content: null },
        },
        {
          type: "tool_end",
          output: JSON.stringify([{ path: "a.ts", kind: "add" }]),
        },
      ])
    })

    it("returns null for an item.completed with no recognized item type", () => {
      const event = parseCodexLine(
        '{"type": "item.completed", "item": {"id": "1", "type": "reasoning"}}',
        mappings
      )
      expect(event).toBeNull()
    })
  })
})

