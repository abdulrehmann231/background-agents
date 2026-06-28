/**
 * Parser tests for parseGeminiLine - pure data transformations from the agent's
 * event format to our standard Event format. No mocks, no I/O.
 */
import { describe, it, expect } from "vitest"
import { parseGeminiLine, GEMINI_TOOL_MAPPINGS } from "../../src/agents/index.js"
import { createContext } from "./helpers.js"

describe("parseGeminiLine", () => {
  const mappings = GEMINI_TOOL_MAPPINGS

  it("returns null for invalid JSON", () => {
    const ctx = createContext()
    expect(parseGeminiLine("not json", mappings, ctx)).toBeNull()
    expect(parseGeminiLine("", mappings, ctx)).toBeNull()
  })

  it("parses init event", () => {
    const ctx = createContext()
    const event = parseGeminiLine(
      '{"type": "init", "session_id": "gemini_session"}',
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "session", id: "gemini_session" })
  })

  it("parses assistant.delta event", () => {
    const ctx = createContext()
    const event = parseGeminiLine(
      '{"type": "assistant.delta", "text": "Sure, I can help"}',
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "token", text: "Sure, I can help" })
  })

  it("parses tool.start event and normalizes name", () => {
    const ctx = createContext()
    const event = parseGeminiLine(
      '{"type": "tool.start", "name": "execute_code"}',
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "tool_start", name: "shell", input: {} })
  })

  it("parses tool.delta event", () => {
    const ctx = createContext()
    const event = parseGeminiLine(
      '{"type": "tool.delta", "text": "running..."}',
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "tool_delta", text: "running..." })
  })

  it("parses tool.end event with accumulated output", () => {
    const ctx = createContext()
    parseGeminiLine('{"type": "tool.start", "name": "write_file"}', mappings, ctx)
    parseGeminiLine('{"type": "tool.delta", "text": "done"}', mappings, ctx)
    const event = parseGeminiLine('{"type": "tool.end"}', mappings, ctx)
    expect(event).toEqual({ type: "tool_end", output: "done" })
  })

  it("parses assistant.complete event", () => {
    const ctx = createContext()
    const event = parseGeminiLine('{"type": "assistant.complete"}', mappings, ctx)
    expect(event).toEqual({ type: "end" })
  })

  it("parses message event (current format) for assistant text", () => {
    const ctx = createContext()
    const event = parseGeminiLine(
      JSON.stringify({ type: "message", role: "assistant", content: "2 + 2 equals 4.", delta: true }),
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "token", text: "2 + 2 equals 4." })
  })

  it("ignores message event for user role", () => {
    const ctx = createContext()
    const event = parseGeminiLine(
      JSON.stringify({ type: "message", role: "user", content: "Please do X." }),
      mappings,
      ctx
    )
    expect(event).toBeNull()
  })

  it("parses result event (current format) as end", () => {
    const ctx = createContext()
    const event = parseGeminiLine(
      JSON.stringify({ type: "result", status: "success", stats: {} }),
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "end" })
  })

  it("parses tool_use event (current format) as tool_start", () => {
    const ctx = createContext()
    const event = parseGeminiLine(
      JSON.stringify({
        type: "tool_use",
        tool_name: "run_shell_command",
        tool_id: "abc123",
        parameters: { command: "ls", description: "List files" },
      }),
      mappings,
      ctx
    )
    // run_shell_command is mapped to "shell" in GEMINI_TOOL_MAPPINGS
    expect(event).toMatchObject({ type: "tool_start", name: "shell" })
  })

  it("parses tool_use for known tool and normalizes name", () => {
    const ctx = createContext()
    const event = parseGeminiLine(
      JSON.stringify({
        type: "tool_use",
        tool_name: "execute_code",
        tool_id: "xyz789",
        parameters: { command: "echo hi" },
      }),
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "tool_start", name: "shell", input: { command: "echo hi" } })
  })

  it("parses tool_result event (current format) with output", () => {
    const ctx = createContext()
    // First emit a tool_use to track the tool_id
    parseGeminiLine(
      JSON.stringify({ type: "tool_use", tool_name: "run_shell_command", tool_id: "abc123", parameters: {} }),
      mappings,
      ctx
    )
    const event = parseGeminiLine(
      JSON.stringify({ type: "tool_result", tool_id: "abc123", status: "success", output: "hello.txt" }),
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "tool_end", output: "hello.txt" })
  })

  it("parses tool_result with no output (empty string) as undefined output", () => {
    const ctx = createContext()
    const event = parseGeminiLine(
      JSON.stringify({ type: "tool_result", tool_id: "noop", status: "success", output: "" }),
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "tool_end", output: undefined })
  })

  it("returns null for unknown event types", () => {
    const ctx = createContext()
    expect(parseGeminiLine('{"type": "unknown"}', mappings, ctx)).toBeNull()
  })
})

