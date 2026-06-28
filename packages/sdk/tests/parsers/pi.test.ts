/**
 * Parser tests for parsePiLine - pure data transformations from the agent's
 * event format to our standard Event format. No mocks, no I/O.
 */
import { describe, it, expect } from "vitest"
import { parsePiLine, PI_TOOL_MAPPINGS } from "../../src/agents/index.js"
import { createContext } from "./helpers.js"

describe("parsePiLine", () => {
  const mappings = PI_TOOL_MAPPINGS

  it("returns null for invalid JSON", () => {
    const ctx = createContext()
    expect(parsePiLine("not json", mappings, ctx)).toBeNull()
    expect(parsePiLine("", mappings, ctx)).toBeNull()
  })

  it("parses session header event", () => {
    const ctx = createContext()
    const event = parsePiLine(
      '{"type": "session", "version": 3, "id": "pi_session_123", "timestamp": "2025-01-01T00:00:00Z", "cwd": "/home/user"}',
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "session", id: "pi_session_123" })
  })

  it("parses message_update with text_delta using delta field", () => {
    const ctx = createContext()
    const event = parsePiLine(
      JSON.stringify({
        type: "message_update",
        message: {},
        assistantMessageEvent: {
          type: "text_delta",
          delta: "Hello from Pi!",
        },
      }),
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "token", text: "Hello from Pi!" })
  })

  it("parses message_update with text_delta using text field", () => {
    const ctx = createContext()
    const event = parsePiLine(
      JSON.stringify({
        type: "message_update",
        message: {},
        assistantMessageEvent: {
          type: "text_delta",
          text: "Alternative text",
        },
      }),
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "token", text: "Alternative text" })
  })

  it("returns null for message_update without text_delta", () => {
    const ctx = createContext()
    const event = parsePiLine(
      JSON.stringify({
        type: "message_update",
        message: {},
        assistantMessageEvent: {
          type: "other_event",
        },
      }),
      mappings,
      ctx
    )
    expect(event).toBeNull()
  })

  it("parses tool_execution_start event", () => {
    const ctx = createContext()
    const event = parsePiLine(
      JSON.stringify({
        type: "tool_execution_start",
        toolCallId: "tool_123",
        toolName: "bash",
        args: { command: "ls -la" },
      }),
      mappings,
      ctx
    )
    expect(event).toEqual({
      type: "tool_start",
      name: "shell",
      input: { command: "ls -la" },
    })
  })

  it("parses tool_execution_start event with read tool", () => {
    const ctx = createContext()
    const event = parsePiLine(
      JSON.stringify({
        type: "tool_execution_start",
        toolCallId: "tool_456",
        toolName: "read",
        args: { file_path: "/path/to/file.ts" },
      }),
      mappings,
      ctx
    )
    expect(event).toEqual({
      type: "tool_start",
      name: "read",
      input: { file_path: "/path/to/file.ts" },
    })
  })

  it("handles tool_execution_start with missing tool name", () => {
    const ctx = createContext()
    const event = parsePiLine(
      JSON.stringify({
        type: "tool_execution_start",
        toolCallId: "tool_789",
      }),
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "tool_start", name: "unknown", input: {} })
  })

  it("parses tool_execution_update event with string result", () => {
    const ctx = createContext()
    const event = parsePiLine(
      JSON.stringify({
        type: "tool_execution_update",
        toolCallId: "tool_123",
        toolName: "bash",
        partialResult: "partial output...",
      }),
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "tool_delta", text: "partial output..." })
  })

  it("parses tool_execution_update event with object result", () => {
    const ctx = createContext()
    const event = parsePiLine(
      JSON.stringify({
        type: "tool_execution_update",
        toolCallId: "tool_123",
        toolName: "read",
        partialResult: { content: "file content" },
      }),
      mappings,
      ctx
    )
    expect(event).toEqual({
      type: "tool_delta",
      text: '{"content":"file content"}',
    })
  })

  it("returns null for tool_execution_update without partialResult", () => {
    const ctx = createContext()
    const event = parsePiLine(
      JSON.stringify({
        type: "tool_execution_update",
        toolCallId: "tool_123",
        toolName: "bash",
      }),
      mappings,
      ctx
    )
    expect(event).toBeNull()
  })

  it("parses tool_execution_end event with string result", () => {
    const ctx = createContext()
    const event = parsePiLine(
      JSON.stringify({
        type: "tool_execution_end",
        toolCallId: "tool_123",
        toolName: "bash",
        result: "command output",
        isError: false,
      }),
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "tool_end", output: "command output" })
  })

  it("parses tool_execution_end event with object result", () => {
    const ctx = createContext()
    const event = parsePiLine(
      JSON.stringify({
        type: "tool_execution_end",
        toolCallId: "tool_123",
        toolName: "read",
        result: { lines: 100 },
      }),
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "tool_end", output: '{"lines":100}' })
  })

  it("parses tool_execution_end event without result", () => {
    const ctx = createContext()
    const event = parsePiLine(
      JSON.stringify({
        type: "tool_execution_end",
        toolCallId: "tool_123",
        toolName: "write",
      }),
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "tool_end" })
  })

  it("parses agent_end event", () => {
    const ctx = createContext()
    const event = parsePiLine(
      JSON.stringify({
        type: "agent_end",
        messages: [],
      }),
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "end" })
  })

  it("parses error event with error field", () => {
    const ctx = createContext()
    const event = parsePiLine(
      JSON.stringify({
        type: "error",
        error: "Rate limit exceeded",
      }),
      mappings,
      ctx
    )
    expect(event).toEqual({
      type: "end",
      error: "Rate limit exceeded — wait a moment and retry",
    })
  })

  it("parses error event with message field", () => {
    const ctx = createContext()
    const event = parsePiLine(
      JSON.stringify({
        type: "error",
        message: "Connection failed",
      }),
      mappings,
      ctx
    )
    expect(event).toEqual({
      type: "end",
      error: "Connection failed — check connectivity and retry",
    })
  })

  it("parses auto_retry_end failure event", () => {
    const ctx = createContext()
    const event = parsePiLine(
      JSON.stringify({
        type: "auto_retry_end",
        success: false,
        attempt: 3,
        finalError: "Max retries exceeded",
      }),
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "end", error: "Max retries exceeded" })
  })

  it("returns null for auto_retry_end success event", () => {
    const ctx = createContext()
    const event = parsePiLine(
      JSON.stringify({
        type: "auto_retry_end",
        success: true,
        attempt: 2,
      }),
      mappings,
      ctx
    )
    expect(event).toBeNull()
  })

  it("returns null for agent_start event", () => {
    const ctx = createContext()
    expect(
      parsePiLine('{"type": "agent_start"}', mappings, ctx)
    ).toBeNull()
  })

  it("returns null for turn_start event", () => {
    const ctx = createContext()
    expect(parsePiLine('{"type": "turn_start"}', mappings, ctx)).toBeNull()
  })

  it("returns null for turn_end event", () => {
    const ctx = createContext()
    expect(
      parsePiLine('{"type": "turn_end", "message": {}}', mappings, ctx)
    ).toBeNull()
  })

  it("returns null for message_start event", () => {
    const ctx = createContext()
    expect(
      parsePiLine('{"type": "message_start", "message": {}}', mappings, ctx)
    ).toBeNull()
  })

  it("returns null for message_end event", () => {
    const ctx = createContext()
    expect(
      parsePiLine('{"type": "message_end", "message": {}}', mappings, ctx)
    ).toBeNull()
  })

  it("returns null for unknown event types", () => {
    const ctx = createContext()
    expect(parsePiLine('{"type": "unknown"}', mappings, ctx)).toBeNull()
  })
})

