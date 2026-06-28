/**
 * Parser tests for parseKiloLine - pure data transformations from the agent's
 * event format to our standard Event format. No mocks, no I/O.
 */
import { describe, it, expect } from "vitest"
import { parseKiloLine, KILO_TOOL_MAPPINGS } from "../../src/agents/index.js"
import { createContext } from "./helpers.js"

describe("parseKiloLine", () => {
  const mappings = KILO_TOOL_MAPPINGS

  it("returns null for invalid JSON", () => {
    const ctx = createContext()
    expect(parseKiloLine("not json", mappings, ctx)).toBeNull()
    expect(parseKiloLine("", mappings, ctx)).toBeNull()
  })

  it("parses step_start event", () => {
    const ctx = createContext()
    const event = parseKiloLine(
      '{"type": "step_start", "sessionID": "ses_kilo123"}',
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "session", id: "ses_kilo123" })
  })

  it("deduplicates step_start for same session", () => {
    const ctx = createContext()
    parseKiloLine('{"type": "step_start", "sessionID": "ses_kilo123"}', mappings, ctx)
    const event = parseKiloLine('{"type": "step_start", "sessionID": "ses_kilo123"}', mappings, ctx)
    expect(event).toBeNull()
  })

  it("parses text event with content", () => {
    const ctx = createContext()
    const event = parseKiloLine(
      '{"type": "text", "sessionID": "ses_kilo123", "part": {"type": "text", "text": "Hello from Kilo!"}}',
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "token", text: "Hello from Kilo!" })
  })

  it("returns null for text event without text type", () => {
    const ctx = createContext()
    const event = parseKiloLine(
      '{"type": "text", "sessionID": "ses_kilo123", "part": {"type": "image"}}',
      mappings,
      ctx
    )
    expect(event).toBeNull()
  })

  it("returns null for text event without text content", () => {
    const ctx = createContext()
    const event = parseKiloLine(
      '{"type": "text", "sessionID": "ses_kilo123", "part": {"type": "text"}}',
      mappings,
      ctx
    )
    expect(event).toBeNull()
  })

  it("drops reasoning events (internal thinking)", () => {
    const ctx = createContext()
    const event = parseKiloLine(
      JSON.stringify({
        type: "reasoning",
        sessionID: "ses_kilo123",
        part: { type: "reasoning", text: "Let me think about this..." },
      }),
      mappings,
      ctx
    )
    expect(event).toBeNull()
  })

  it("parses tool_call event", () => {
    const ctx = createContext()
    const event = parseKiloLine(
      '{"type": "tool_call", "sessionID": "ses_kilo123", "part": {"type": "tool-call", "tool": "write"}}',
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "tool_start", name: "write", input: {} })
  })

  it("normalizes bash tool to shell", () => {
    const ctx = createContext()
    const event = parseKiloLine(
      JSON.stringify({
        type: "tool_call",
        sessionID: "ses_kilo123",
        part: { type: "tool-call", tool: "bash", args: { command: "ls" } },
      }),
      mappings,
      ctx
    )
    expect(event).toMatchObject({ type: "tool_start", name: "shell" })
  })

  it("handles tool_call with missing tool name", () => {
    const ctx = createContext()
    const event = parseKiloLine(
      '{"type": "tool_call", "sessionID": "ses_kilo123", "part": {"type": "tool-call"}}',
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "tool_start", name: "unknown", input: {} })
  })

  it("parses tool_use event with output as [tool_start, tool_end]", () => {
    const ctx = createContext()
    const events = parseKiloLine(
      JSON.stringify({
        type: "tool_use",
        sessionID: "ses_kilo123",
        part: {
          id: "prt_123",
          tool: "read",
          state: {
            status: "completed",
            input: { filePath: "/tmp/test.txt" },
            output: "file contents here",
          },
        },
      }),
      mappings,
      ctx
    )
    expect(Array.isArray(events)).toBe(true)
    const arr = events as any[]
    expect(arr[0]).toMatchObject({ type: "tool_start", name: "read" })
    expect(arr[1]).toEqual({ type: "tool_end", output: "file contents here" })
  })

  it("parses tool_use event without output as tool_start only", () => {
    const ctx = createContext()
    const event = parseKiloLine(
      JSON.stringify({
        type: "tool_use",
        sessionID: "ses_kilo123",
        part: {
          id: "prt_123",
          tool: "write",
          state: { status: "running", input: { filePath: "/tmp/out.txt" } },
        },
      }),
      mappings,
      ctx
    )
    expect(event).toMatchObject({ type: "tool_start", name: "write" })
  })

  it("parses tool_result event", () => {
    const ctx = createContext()
    const event = parseKiloLine(
      '{"type": "tool_result", "sessionID": "ses_kilo123"}',
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "tool_end" })
  })

  it("parses step_finish with reason stop as end", () => {
    const ctx = createContext()
    const event = parseKiloLine(
      '{"type": "step_finish", "sessionID": "ses_kilo123", "part": {"reason": "stop"}}',
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "end" })
  })

  it("returns null for step_finish with non-stop reason", () => {
    const ctx = createContext()
    const event = parseKiloLine(
      '{"type": "step_finish", "sessionID": "ses_kilo123", "part": {"reason": "tool-calls"}}',
      mappings,
      ctx
    )
    expect(event).toBeNull()
  })

  it("parses error event with error message", () => {
    const ctx = createContext()
    const event = parseKiloLine(
      '{"type": "error", "sessionID": "ses_kilo123", "error": {"name": "APIError", "data": {"message": "Rate limit exceeded"}}}',
      mappings,
      ctx
    )
    expect(event).toEqual({
      type: "end",
      error: "Rate limit exceeded — wait a moment and retry",
    })
  })

  it("parses error event falling back to error name", () => {
    const ctx = createContext()
    const event = parseKiloLine(
      '{"type": "error", "sessionID": "ses_kilo123", "error": {"name": "APIError"}}',
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "end", error: "APIError" })
  })

  it("returns null for unknown event types", () => {
    const ctx = createContext()
    expect(parseKiloLine('{"type": "unknown"}', mappings, ctx)).toBeNull()
  })
})

