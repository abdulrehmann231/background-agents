/**
 * Parser tests for parseElizaLine - pure data transformations from the agent's
 * event format to our standard Event format. No mocks, no I/O.
 */
import { describe, it, expect } from "vitest"
import { parseElizaLine, ELIZA_TOOL_MAPPINGS } from "../../src/agents/index.js"

describe("parseElizaLine", () => {
  const mappings = ELIZA_TOOL_MAPPINGS

  it("returns null for invalid JSON", () => {
    expect(parseElizaLine("not json", mappings)).toBeNull()
    expect(parseElizaLine("", mappings)).toBeNull()
    expect(parseElizaLine("{not valid json}", mappings)).toBeNull()
  })

  it("parses system init event", () => {
    const event = parseElizaLine(
      '{"type": "system", "subtype": "init", "session_id": "eliza-123"}',
      mappings
    )
    expect(event).toEqual({ type: "session", id: "eliza-123" })
  })

  it("parses assistant message with text", () => {
    const event = parseElizaLine(
      JSON.stringify({
        type: "assistant",
        message: {
          id: "msg_123",
          content: [{ type: "text", text: "Why do you say you are sad?" }],
        },
        session_id: "eliza-123",
      }),
      mappings
    )
    expect(event).toEqual({ type: "token", text: "Why do you say you are sad?" })
  })

  it("parses assistant message with tool_use (Write)", () => {
    const event = parseElizaLine(
      JSON.stringify({
        type: "assistant",
        message: {
          id: "msg_123",
          content: [
            {
              type: "tool_use",
              id: "toolu_abc",
              name: "Write",
              input: { file_path: "/tmp/test.txt", content: "hello" },
            },
          ],
        },
        session_id: "eliza-123",
      }),
      mappings
    )
    expect(event).toMatchObject({ type: "tool_start", name: "write" })
  })

  it("parses assistant message with tool_use (Read)", () => {
    const event = parseElizaLine(
      JSON.stringify({
        type: "assistant",
        message: {
          id: "msg_123",
          content: [
            {
              type: "tool_use",
              id: "toolu_abc",
              name: "Read",
              input: { file_path: "/tmp/test.txt" },
            },
          ],
        },
        session_id: "eliza-123",
      }),
      mappings
    )
    expect(event).toMatchObject({ type: "tool_start", name: "read" })
  })

  it("parses assistant message with tool_use (Bash)", () => {
    const event = parseElizaLine(
      JSON.stringify({
        type: "assistant",
        message: {
          id: "msg_123",
          content: [
            {
              type: "tool_use",
              id: "toolu_abc",
              name: "Bash",
              input: { command: "rm /tmp/file.txt" },
            },
          ],
        },
        session_id: "eliza-123",
      }),
      mappings
    )
    expect(event).toMatchObject({ type: "tool_start", name: "shell" })
  })

  it("parses tool_result success", () => {
    const event = parseElizaLine(
      JSON.stringify({
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_abc",
              content: "File written successfully",
            },
          ],
        },
        session_id: "eliza-123",
      }),
      mappings
    )
    expect(event).toEqual({ type: "tool_end", output: "File written successfully" })
  })

  it("parses tool_result error", () => {
    const event = parseElizaLine(
      JSON.stringify({
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_abc",
              content: "Permission denied",
              is_error: true,
            },
          ],
        },
        session_id: "eliza-123",
      }),
      mappings
    )
    expect(event).toEqual({ type: "tool_end", output: "Error: Permission denied" })
  })

  it("parses result success event", () => {
    const event = parseElizaLine(
      JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: false,
        result: "Session complete",
        session_id: "eliza-123",
      }),
      mappings
    )
    expect(event).toEqual({ type: "end" })
  })

  it("parses result error event", () => {
    const event = parseElizaLine(
      JSON.stringify({
        type: "result",
        subtype: "error",
        is_error: true,
        result: "No prompt provided",
        session_id: "eliza-123",
      }),
      mappings
    )
    expect(event).toEqual({ type: "end", error: "No prompt provided" })
  })

  it("returns null for assistant message with empty content", () => {
    const event = parseElizaLine(
      JSON.stringify({
        type: "assistant",
        message: { id: "msg_123", content: [] },
        session_id: "eliza-123",
      }),
      mappings
    )
    expect(event).toBeNull()
  })

  it("returns null for unknown event types", () => {
    expect(parseElizaLine('{"type": "unknown_event"}', mappings)).toBeNull()
  })
})

