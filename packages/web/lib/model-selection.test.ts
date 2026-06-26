/**
 * Unit tests for resolveModelForAgent — the single resolver that decides which
 * model an agent should use, honoring the user's saved default preference only
 * when it's actually applicable.
 *
 * Pure function — no mocks needed. Fixtures use real agents/models so the test
 * stays honest about the credential rules.
 */
import { describe, it, expect } from "vitest"
import { resolveModelForAgent, type CustomEndpoint } from "@background-agents/common"

describe("resolveModelForAgent", () => {
  it("honors a saved preference that belongs to the agent and is usable", () => {
    const model = resolveModelForAgent("gemini", { GEMINI_API_KEY: true }, "gemini-2.5-pro")
    expect(model).toBe("gemini-2.5-pro")
  })

  it("ignores a saved preference the user can't use (locked), falling back to the agent default", () => {
    // No Gemini credentials → the preferred (locked) model is dropped in favor
    // of the standard default rather than landing the user on a dead end.
    const model = resolveModelForAgent("gemini", {}, "gemini-2.5-pro")
    expect(model).not.toBe("gemini-2.5-pro")
    expect(model).toBe("gemini-2.5-flash") // hardcoded default for the agent
  })

  it("ignores a saved preference that belongs to a different agent", () => {
    // "opus" is a claude-code model; it must not leak into the gemini agent.
    const model = resolveModelForAgent("gemini", { GEMINI_API_KEY: true }, "opus")
    expect(model).toBe("gemini-2.5-flash")
  })

  it("falls back to the agent default when no preference is set", () => {
    expect(resolveModelForAgent("gemini", { GEMINI_API_KEY: true }, null)).toBe("gemini-2.5-flash")
    expect(resolveModelForAgent("gemini", { GEMINI_API_KEY: true }, undefined)).toBe("gemini-2.5-flash")
  })

  it("honors a saved preference pointing at a custom endpoint when endpoints are supplied", () => {
    const endpoint: CustomEndpoint = {
      id: "e1",
      name: "My Endpoint",
      type: "opencode",
      baseUrl: "https://example.com",
      model: "some-model",
      headers: "",
    }
    const model = resolveModelForAgent("opencode", {}, "endpoint:e1", [endpoint])
    expect(model).toBe("endpoint:e1")
  })
})
