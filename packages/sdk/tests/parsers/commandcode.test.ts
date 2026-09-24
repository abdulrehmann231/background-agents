/**
 * Parser tests for parseCommandCodeLine - pure data transformations from the
 * agent's event format to our standard Event format. No mocks, no I/O.
 *
 * The frame shapes below are taken from the Command Code CLI's own bundled
 * headless reference and its event emitters, not from a captured run: there is
 * no `commandcode.jsonl` reference fixture yet because capturing one needs a
 * live COMMAND_CODE_API_KEY (`npm run generate:jsonl-refs -- commandcode`).
 */
import { describe, it, expect } from "vitest"
import { parseCommandCodeLine, COMMAND_CODE_TOOL_MAPPINGS } from "../../src/agents/index.js"
import { createContext } from "./helpers.js"

const mappings = COMMAND_CODE_TOOL_MAPPINGS

/** Wrap an AgentEvent in the `{type:"event"}` envelope the CLI emits. */
const frame = (event: unknown) => JSON.stringify({ type: "event", event })

describe("parseCommandCodeLine", () => {
  it("returns null for non-JSON lines and for frames it does not consume", () => {
    const ctx = createContext()
    expect(parseCommandCodeLine("not json", mappings, ctx)).toBeNull()
    expect(parseCommandCodeLine("", mappings, ctx)).toBeNull()
    expect(
      parseCommandCodeLine(frame({ type: "turn_start", turnNumber: 1 }), mappings, ctx)
    ).toBeNull()
    // Thinking is internal; message_end re-states text we already streamed.
    expect(
      parseCommandCodeLine(frame({ type: "thinking_delta", delta: "hmm" }), mappings, ctx)
    ).toBeNull()
    expect(
      parseCommandCodeLine(frame({ type: "message_end", content: [] }), mappings, ctx)
    ).toBeNull()
  })

  it("emits the session id from run_start", () => {
    expect(
      parseCommandCodeLine(
        frame({ type: "run_start", sessionId: "9f4e1c0a" }),
        mappings,
        createContext()
      )
    ).toEqual({ type: "session", id: "9f4e1c0a" })
  })

  it("emits tokens from text_delta", () => {
    expect(
      parseCommandCodeLine(frame({ type: "text_delta", delta: "Hi" }), mappings, createContext())
    ).toEqual({ type: "token", text: "Hi" })
  })

  it("emits a normalized tool_start from tool_queued, and ignores tool_running", () => {
    const ctx = createContext()
    expect(
      parseCommandCodeLine(
        frame({
          type: "tool_queued",
          toolCallId: "t1",
          toolName: "read_file",
          input: { file_path: "/repo/index.ts" },
        }),
        mappings,
        ctx
      )
    ).toEqual({ type: "tool_start", name: "read", input: { file_path: "/repo/index.ts" } })

    // tool_running repeats the name without the input — dropping it is what
    // keeps a single tool call from opening two cards.
    expect(
      parseCommandCodeLine(
        frame({ type: "tool_running", toolCallId: "t1", toolName: "read_file", description: "…" }),
        mappings,
        ctx
      )
    ).toBeNull()
  })

  it("maps shell_command to the canonical shell tool", () => {
    expect(
      parseCommandCodeLine(
        frame({
          type: "tool_queued",
          toolCallId: "t2",
          toolName: "shell_command",
          input: { command: "ls" },
        }),
        mappings,
        createContext()
      )
    ).toEqual({ type: "tool_start", name: "shell", input: { command: "ls" } })
  })

  it("closes the tool on completion, error and denial", () => {
    const ctx = createContext()
    expect(
      parseCommandCodeLine(
        frame({ type: "tool_completed", toolCallId: "t1", toolName: "grep", result: "3 matches" }),
        mappings,
        ctx
      )
    ).toEqual({ type: "tool_end", output: "3 matches" })

    expect(
      parseCommandCodeLine(
        frame({ type: "tool_errored", toolCallId: "t1", toolName: "grep", error: "no such file" }),
        mappings,
        ctx
      )
    ).toEqual({ type: "tool_end", output: "no such file" })

    expect(
      parseCommandCodeLine(
        frame({ type: "tool_denied", toolCallId: "t1", toolName: "write_file" }),
        mappings,
        ctx
      )
    ).toEqual({ type: "tool_end", output: "Tool call denied" })
  })

  it("ends the turn on the result line without replaying finalText", () => {
    const ctx = createContext()
    const events = parseCommandCodeLine(
      JSON.stringify({
        type: "result",
        subtype: "success",
        sessionId: "9f4e1c0a",
        stopReason: "end_turn",
        usage: { inputTokens: 10, outputTokens: 5 },
        durationMs: 8421,
        finalText: "Hi",
      }),
      mappings,
      ctx
    )
    // finalText echoes the text_deltas we already streamed, so only the
    // session id and the end survive.
    expect(events).toEqual([{ type: "session", id: "9f4e1c0a" }, { type: "end" }])
  })

  it("does not repeat the session id the context already has", () => {
    const ctx = createContext()
    ctx.sessionId = "9f4e1c0a"
    expect(
      parseCommandCodeLine(
        JSON.stringify({ type: "result", subtype: "success", sessionId: "9f4e1c0a" }),
        mappings,
        ctx
      )
    ).toEqual({ type: "end" })
  })

  it("surfaces an error result as a classified end error", () => {
    const end = parseCommandCodeLine(
      JSON.stringify({
        type: "result",
        subtype: "error",
        error: "Insufficient credits for this request",
      }),
      mappings,
      createContext()
    ) as { type: string; error: string }
    expect(end.type).toBe("end")
    expect(end.error).toContain("Insufficient credits")
  })

  it("carries a run_error frame through to the result line", () => {
    const ctx = createContext()
    // The failure detail only ever appears in this frame...
    expect(
      parseCommandCodeLine(
        frame({
          type: "run_error",
          error: { name: "Error", message: "provider returned 401 Unauthorized" },
        }),
        mappings,
        ctx
      )
    ).toBeNull()

    // ...while the result line still reports subtype "success".
    const end = parseCommandCodeLine(
      JSON.stringify({
        type: "result",
        subtype: "success",
        stopReason: "run_error",
        finalText: "",
      }),
      mappings,
      ctx
    ) as { type: string; error: string }
    expect(end.type).toBe("end")
    expect(end.error).toContain("401 Unauthorized")
  })

  it("reports a max_turns result as an unfinished turn", () => {
    const end = parseCommandCodeLine(
      JSON.stringify({ type: "result", subtype: "max_turns", stopReason: "max_turns" }),
      mappings,
      createContext()
    ) as { type: string; error: string }
    expect(end.type).toBe("end")
    expect(end.error).toContain("maximum number of turns")
  })
})
