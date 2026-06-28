/**
 * Parser tests for parseCopilotLine - pure data transformations from the agent's
 * event format to our standard Event format. No mocks, no I/O.
 */
import { describe, it, expect } from "vitest"
import { parseCopilotLine, COPILOT_TOOL_MAPPINGS } from "../../src/agents/index.js"
import { createContext } from "./helpers.js"

describe("parseCopilotLine", () => {
  const mappings = COPILOT_TOOL_MAPPINGS

  it("returns null for invalid JSON", () => {
    expect(parseCopilotLine("not json", mappings)).toBeNull()
    expect(parseCopilotLine("", mappings)).toBeNull()
    expect(parseCopilotLine("{bad}", mappings)).toBeNull()
  })

  it("returns null for JSON without type field", () => {
    expect(parseCopilotLine('{"foo": "bar"}', mappings)).toBeNull()
  })

  it("parses session.start event", () => {
    const event = parseCopilotLine(
      JSON.stringify({ type: "session.start", sessionId: "sess-abc-123" }),
      mappings
    )
    expect(event).toEqual({ type: "session", id: "sess-abc-123" })
  })

  it("parses session.start with missing sessionId", () => {
    const event = parseCopilotLine(
      JSON.stringify({ type: "session.start" }),
      mappings
    )
    expect(event).toEqual({ type: "session", id: "" })
  })

  it("parses message.delta event", () => {
    const event = parseCopilotLine(
      JSON.stringify({ type: "message.delta", content: "Hello world" }),
      mappings
    )
    expect(event).toEqual({ type: "token", text: "Hello world" })
  })

  it("parses assistant.message_delta event (alternate naming)", () => {
    const event = parseCopilotLine(
      JSON.stringify({ type: "assistant.message_delta", deltaContent: "chunk" }),
      mappings
    )
    expect(event).toEqual({ type: "token", text: "chunk" })
  })

  it("returns null for message.delta with empty content", () => {
    const event = parseCopilotLine(
      JSON.stringify({ type: "message.delta" }),
      mappings
    )
    expect(event).toBeNull()
  })

  it("parses tool.call event with shell tool", () => {
    const event = parseCopilotLine(
      JSON.stringify({
        type: "tool.call",
        name: "shell",
        arguments: { command: "ls -la" },
        callId: "call_001",
      }),
      mappings
    )
    expect(event).toMatchObject({
      type: "tool_start",
      name: "shell",
    })
  })

  it("parses tool.start event (alternate naming)", () => {
    const event = parseCopilotLine(
      JSON.stringify({
        type: "tool.start",
        name: "read_file",
        arguments: { file_path: "/src/main.ts" },
      }),
      mappings
    )
    expect(event).toMatchObject({
      type: "tool_start",
      name: "read",
    })
  })

  it("normalizes tool names through mappings", () => {
    const event = parseCopilotLine(
      JSON.stringify({
        type: "tool.call",
        name: "create_file",
        arguments: { file_path: "/new.ts", content: "// new" },
      }),
      mappings
    )
    expect(event).toMatchObject({
      type: "tool_start",
      name: "write",
    })
  })

  it("parses tool.result event", () => {
    const event = parseCopilotLine(
      JSON.stringify({
        type: "tool.result",
        callId: "call_001",
        result: "main.go\nREADME.md",
      }),
      mappings
    )
    expect(event).toEqual({
      type: "tool_end",
      output: "main.go\nREADME.md",
    })
  })

  it("parses tool.end event (alternate naming) with output field", () => {
    const event = parseCopilotLine(
      JSON.stringify({
        type: "tool.end",
        output: "done",
      }),
      mappings
    )
    expect(event).toEqual({ type: "tool_end", output: "done" })
  })

  it("parses turn.end success", () => {
    const event = parseCopilotLine(
      JSON.stringify({ type: "turn.end", status: "success" }),
      mappings
    )
    expect(event).toEqual({ type: "end" })
  })

  it("parses turn.end with error status (string error)", () => {
    const event = parseCopilotLine(
      JSON.stringify({
        type: "turn.end",
        status: "error",
        error: "Rate limit exceeded",
      }),
      mappings
    )
    expect(event).toEqual({
      type: "end",
      error: "Rate limit exceeded — wait a moment and retry",
    })
  })

  it("parses turn.end with error status (object error)", () => {
    const event = parseCopilotLine(
      JSON.stringify({
        type: "turn.end",
        status: "error",
        error: { message: "Something went wrong" },
      }),
      mappings
    )
    expect(event).toEqual({ type: "end", error: "Something went wrong" })
  })

  it("parses turn.end with non-success status but no error field", () => {
    const event = parseCopilotLine(
      JSON.stringify({ type: "turn.end", status: "cancelled" }),
      mappings
    )
    expect(event).toEqual({ type: "end", error: "Turn ended with status: cancelled" })
  })

  it("ignores assistant.turn_end in autopilot mode (end comes from session.task_complete)", () => {
    // In autopilot mode the CLI fires a continuation turn after assistant.turn_end,
    // so the parser intentionally returns null here. The true terminal event is
    // session.task_complete. See parser comment for details.
    const event = parseCopilotLine(
      JSON.stringify({ type: "assistant.turn_end", status: "success" }),
      mappings
    )
    expect(event).toBeNull()
  })

  it("parses session.shutdown as end event", () => {
    const event = parseCopilotLine(
      JSON.stringify({ type: "session.shutdown" }),
      mappings
    )
    expect(event).toEqual({ type: "end" })
  })

  it("returns null for unknown event types", () => {
    expect(
      parseCopilotLine('{"type": "permission.requested"}', mappings)
    ).toBeNull()
    expect(
      parseCopilotLine('{"type": "session.compaction"}', mappings)
    ).toBeNull()
  })

  it("suppresses internal autopilot tool: report_intent", () => {
    const event = parseCopilotLine(
      JSON.stringify({
        type: "tool.execution_start",
        data: { toolName: "report_intent", toolCallId: "call_ri_001" },
      }),
      mappings
    )
    expect(event).toBeNull()
  })

  it("suppresses internal autopilot tool: ask_user", () => {
    const event = parseCopilotLine(
      JSON.stringify({
        type: "tool.execution_start",
        data: { toolName: "ask_user", toolCallId: "call_au_001" },
      }),
      mappings
    )
    expect(event).toBeNull()
  })

  it("suppresses internal autopilot tool: task_complete", () => {
    const event = parseCopilotLine(
      JSON.stringify({
        type: "tool.execution_start",
        data: { toolName: "task_complete", toolCallId: "call_tc_001" },
      }),
      mappings
    )
    expect(event).toBeNull()
  })

  it("suppresses tool.execution_complete for a suppressed internal tool call ID", () => {
    const ctx = createContext()
    // Suppress the tool_start
    const startEvent = parseCopilotLine(
      JSON.stringify({
        type: "tool.execution_start",
        data: { toolName: "report_intent", toolCallId: "call_ri_002" },
      }),
      mappings,
      ctx
    )
    expect(startEvent).toBeNull()

    // The paired tool_end should also be suppressed
    const endEvent = parseCopilotLine(
      JSON.stringify({
        type: "tool.execution_complete",
        data: { toolCallId: "call_ri_002" },
      }),
      mappings,
      ctx
    )
    expect(endEvent).toBeNull()
  })

  it("does NOT suppress tool.execution_complete for a real tool call ID", () => {
    const ctx = createContext()
    // A real shell tool — should NOT be suppressed
    parseCopilotLine(
      JSON.stringify({
        type: "tool.execution_start",
        data: { toolName: "shell", toolCallId: "call_sh_001", arguments: { command: "ls" } },
      }),
      mappings,
      ctx
    )
    const endEvent = parseCopilotLine(
      JSON.stringify({
        type: "tool.execution_complete",
        data: { toolCallId: "call_sh_001", result: { content: "file.ts\n" } },
      }),
      mappings,
      ctx
    )
    expect(endEvent).toEqual({ type: "tool_end", output: "file.ts\n" })
  })

  // ─── assistant.message_delta ───────────────────────────────────────────────
  // The ephemeral flag is NOT the discriminator. Continuation state is.

  it("passes through assistant.message_delta (ephemeral: true) during the initial turn", () => {
    // gpt-5-mini marks ALL deltas ephemeral: true, including real responses.
    // Without a continuation flag set, the delta must be emitted.
    const ctx = createContext()
    const event = parseCopilotLine(
      JSON.stringify({
        type: "assistant.message_delta",
        data: { deltaContent: "Dogs are loyal companions.", messageId: "msg-1" },
        ephemeral: true,
      }),
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "token", text: "Dogs are loyal companions." })
  })

  it("passes through assistant.message_delta (ephemeral: false) during the initial turn", () => {
    const ctx = createContext()
    const event = parseCopilotLine(
      JSON.stringify({
        type: "assistant.message_delta",
        data: { deltaContent: "Hello!", messageId: "msg-2" },
        ephemeral: false,
      }),
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "token", text: "Hello!" })
  })

  it("suppresses assistant.message_delta during autopilot continuation turn", () => {
    // session.info sets the continuation flag; subsequent deltas are narration.
    const ctx = createContext()
    parseCopilotLine(
      JSON.stringify({
        type: "session.info",
        data: { infoType: "autopilot_continuation", message: "Continuing autonomously" },
        ephemeral: true,
      }),
      mappings,
      ctx
    )
    const event = parseCopilotLine(
      JSON.stringify({
        type: "assistant.message_delta",
        data: { deltaContent: "Marking the task complete.", messageId: "msg-narrate" },
        ephemeral: true,
      }),
      mappings,
      ctx
    )
    expect(event).toBeNull()
  })

  // ─── assistant.message ────────────────────────────────────────────────────

  it("emits text from assistant.message with no tool requests (gpt-4.1 final response)", () => {
    const ctx = createContext()
    const event = parseCopilotLine(
      JSON.stringify({
        type: "assistant.message",
        data: {
          messageId: "msg-3",
          content: "Here is my final answer.",
          toolRequests: [],
        },
      }),
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "token", text: "Here is my final answer." })
  })

  it("emits text from assistant.message even when ephemeral: true (before continuation flag)", () => {
    // gpt-5-mini may mark assistant.message ephemeral. The ephemeral flag alone
    // must not suppress it — only the continuation state should.
    const ctx = createContext()
    const event = parseCopilotLine(
      JSON.stringify({
        type: "assistant.message",
        data: { messageId: "msg-5", content: "Here is my response.", toolRequests: [] },
        ephemeral: true,
      }),
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "token", text: "Here is my response." })
  })

  it("suppresses assistant.message with tool requests (prelude to tool call)", () => {
    const ctx = createContext()
    const event = parseCopilotLine(
      JSON.stringify({
        type: "assistant.message",
        data: {
          messageId: "msg-4",
          content: "Let me check the filesystem.",
          toolRequests: [{ toolCallId: "call_abc", name: "bash", type: "function" }],
        },
      }),
      mappings,
      ctx
    )
    expect(event).toBeNull()
  })

  it("suppresses assistant.message during autopilot continuation turn", () => {
    const ctx = createContext()
    parseCopilotLine(
      JSON.stringify({
        type: "session.info",
        data: { infoType: "autopilot_continuation", message: "Continuing autonomously" },
        ephemeral: true,
      }),
      mappings,
      ctx
    )
    const event = parseCopilotLine(
      JSON.stringify({
        type: "assistant.message",
        data: { messageId: "msg-cont", content: "Internal narration.", toolRequests: [] },
      }),
      mappings,
      ctx
    )
    expect(event).toBeNull()
  })

  it("returns null for assistant.message with empty content and no tool requests", () => {
    const ctx = createContext()
    const event = parseCopilotLine(
      JSON.stringify({
        type: "assistant.message",
        data: { messageId: "msg-6", content: "", toolRequests: [] },
      }),
      mappings,
      ctx
    )
    expect(event).toBeNull()
  })

  // ─── session.info ─────────────────────────────────────────────────────────

  it("session.info autopilot_continuation sets continuation flag and returns null", () => {
    const ctx = createContext()
    const event = parseCopilotLine(
      JSON.stringify({
        type: "session.info",
        data: { infoType: "autopilot_continuation", message: "Continuing autonomously (1 premium request)" },
        ephemeral: true,
      }),
      mappings,
      ctx
    )
    expect(event).toBeNull()
    expect(ctx.state["copilot_in_autopilot_continuation"]).toBe(true)
  })

  it("session.info with other infoType does not set continuation flag", () => {
    const ctx = createContext()
    parseCopilotLine(
      JSON.stringify({
        type: "session.info",
        data: { infoType: "some_other_info", message: "something" },
      }),
      mappings,
      ctx
    )
    expect(ctx.state["copilot_in_autopilot_continuation"]).toBeUndefined()
  })

  // ─── Fixture-driven integration tests ────────────────────────────────────
  // Replay full JSONL streams and assert the correct token sequence.

  it("gpt-5-mini stream: emits response tokens from initial-turn deltas, suppresses continuation narration", () => {
    const fs = require("fs")
    const path = require("path")
    const fixture = fs.readFileSync(
      path.join(__dirname, "../fixtures/jsonl-reference/copilot-gpt-5-mini.jsonl"),
      "utf-8"
    )
    const lines = fixture.split("\n").filter(Boolean)
    const ctx = createContext()
    const tokens: string[] = []
    const events: string[] = []
    for (const line of lines) {
      const event = parseCopilotLine(line, mappings, ctx)
      if (!event) continue
      if (event.type === "token") tokens.push((event as { type: "token"; text: string }).text)
      else events.push(event.type)
    }
    // Should have emitted the initial-turn deltas as tokens
    expect(tokens.length).toBeGreaterThan(0)
    expect(tokens.join("")).toContain("Dogs")
    // No continuation narration ("Marking") should have leaked through
    expect(tokens.join("")).not.toContain("Mark")
    // Should have emitted exactly one end event (from session.task_complete)
    expect(events).toContain("end")
    expect(events.filter(e => e === "end")).toHaveLength(1)
  })

  it("gpt-4.1 stream: emits response from assistant.message, suppresses continuation turn", () => {
    const fs = require("fs")
    const path = require("path")
    const fixture = fs.readFileSync(
      path.join(__dirname, "../fixtures/jsonl-reference/copilot-gpt-4.1.jsonl"),
      "utf-8"
    )
    const lines = fixture.split("\n").filter(Boolean)
    const ctx = createContext()
    const tokens: string[] = []
    const events: string[] = []
    for (const line of lines) {
      const event = parseCopilotLine(line, mappings, ctx)
      if (!event) continue
      if (event.type === "token") tokens.push((event as { type: "token"; text: string }).text)
      else events.push(event.type)
    }
    // Response content arrives via streaming deltas; assistant.message is
    // suppressed by the messageId dedup. The joined text must equal the full
    // response and must not be repeated (repetition bug).
    const fullText = tokens.join("")
    expect(fullText).toBe("Dogs are loyal and affectionate companions.")
    // No duplicate: the text appears exactly once
    expect(fullText.indexOf("Dogs")).toBe(0)
    expect(fullText.lastIndexOf("Dogs")).toBe(0)
    // One end event (result is suppressed since task_complete already fired)
    expect(events).toContain("end")
    expect(events.filter(e => e === "end")).toHaveLength(1)
  })
})

