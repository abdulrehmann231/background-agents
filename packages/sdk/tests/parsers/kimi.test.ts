/**
 * Parser tests for parseKimiLine - pure data transformations from the agent's
 * event format to our standard Event format. No mocks, no I/O.
 */
import { describe, it, expect } from "vitest"
import { parseKimiLine, KIMI_TOOL_MAPPINGS } from "../../src/agents/index.js"
import { parseFixtureEvents } from "./helpers.js"

describe("parseKimiLine", () => {
  const mappings = KIMI_TOOL_MAPPINGS

  it("returns null for non-JSON, non-error lines", () => {
    expect(parseKimiLine("not json", mappings)).toBeNull()
    expect(parseKimiLine("", mappings)).toBeNull()
    // The log-path line Kimi prints after an error must be ignored.
    expect(
      parseKimiLine("See log: /home/daytona/.kimi-code/logs/kimi-code.log", mappings)
    ).toBeNull()
  })

  it("emits token + tool_start events from an assistant message", () => {
    const event = parseKimiLine(
      '{"role":"assistant","content":"Hi","tool_calls":[{"type":"function","id":"Bash_0","function":{"name":"Bash","arguments":"{\\"command\\":\\"ls\\"}"}}]}',
      mappings
    )
    expect(event).toEqual([
      { type: "token", text: "Hi" },
      { type: "tool_start", name: "shell", input: { command: "ls" } },
    ])
  })

  it("emits tool_end from a tool result line", () => {
    expect(
      parseKimiLine('{"role":"tool","tool_call_id":"Bash_0","content":"ok"}', mappings)
    ).toEqual({ type: "tool_end", output: "ok" })
  })

  it("emits session + end from the resume_hint meta line", () => {
    expect(
      parseKimiLine(
        '{"role":"meta","type":"session.resume_hint","session_id":"session_abc"}',
        mappings
      )
    ).toEqual([{ type: "session", id: "session_abc" }, { type: "end" }])
  })

  // ─── Fixture-driven ──────────────────────────────────────────────────────

  it("success stream: parses the reference fixture into tokens, tools and one end", () => {
    const events = parseFixtureEvents("kimi.jsonl", (line) =>
      parseKimiLine(line, mappings)
    ) as { type: string; text?: string; id?: string }[]
    const types = events.map((e) => e.type)
    const tokens = events.filter((e) => e.type === "token").map((e) => e.text!)
    const sessionId = events.find((e) => e.type === "session")?.id
    expect(tokens.join("")).toContain("2 + 2 = 4")
    expect(types).toContain("tool_start")
    expect(types).toContain("tool_end")
    expect(sessionId).toMatch(/^session_/)
    expect(types.filter((t) => t === "end")).toHaveLength(1)
  })

  it("out-of-credits stream: surfaces a classified balance error (not a silent crash)", () => {
    const events = parseFixtureEvents("kimi-error.jsonl", (line) =>
      parseKimiLine(line, mappings)
    ) as { type: string; error?: string }[]
    const end = events.find((e) => e.type === "end")
    expect(end).toBeDefined()
    // The raw provider detail is preserved …
    expect(end!.error).toContain("insufficient balance")
    // … and an actionable hint is appended (balance category).
    expect(end!.error).toContain("add credits")
  })
})
