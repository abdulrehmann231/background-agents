/**
 * Tests for the shared agent-error extraction + classification helpers.
 * Pure functions, no I/O.
 */
import { describe, it, expect, vi } from "vitest"
import {
  extractErrorMessage,
  classifyAgentError,
  resolveAgentError,
} from "../src/utils/errors.js"

describe("extractErrorMessage", () => {
  it("returns the string itself for string input", () => {
    expect(extractErrorMessage("boom")).toBe("boom")
    expect(extractErrorMessage("  trimmed  ")).toBe("trimmed")
  })

  it("returns empty string for null/undefined", () => {
    expect(extractErrorMessage(null)).toBe("")
    expect(extractErrorMessage(undefined)).toBe("")
  })

  it("prefers data.message, then message, then name", () => {
    expect(extractErrorMessage({ data: { message: "deep" }, message: "shallow" })).toBe("deep")
    expect(extractErrorMessage({ message: "shallow", name: "X" })).toBe("shallow")
    expect(extractErrorMessage({ name: "APIError" })).toBe("APIError")
  })

  it("reads nested error.data.message and error.message", () => {
    expect(extractErrorMessage({ error: { data: { message: "nested deep" } } })).toBe("nested deep")
    expect(extractErrorMessage({ error: { message: "nested" } })).toBe("nested")
    expect(extractErrorMessage({ error: "string error" })).toBe("string error")
  })

  it("falls back to a compact JSON dump so detail is never lost", () => {
    // This is the failure that motivated the module: an error event with no
    // message/name field. Previously collapsed to "Unknown error"; now the raw
    // payload (here the status code) is surfaced.
    expect(extractErrorMessage({ statusCode: 402, providerID: "opencode" })).toBe(
      '{"statusCode":402,"providerID":"opencode"}'
    )
  })

  it("returns empty string for an empty object", () => {
    expect(extractErrorMessage({})).toBe("")
  })

  it("does not clip a long object dump to the 600-char log cap", () => {
    // The user-facing fallback dump must keep enough detail to be useful — an
    // aggressive cap discards the real failure reason before it reaches the UI.
    const detail = "x".repeat(5000)
    const result = extractErrorMessage({ stack: detail })
    expect(result.length).toBeGreaterThan(4000)
    expect(result).toContain(detail)
  })
})

describe("classifyAgentError", () => {
  it.each(["400 invalid_request_error: parameter temperature is not supported", "This model's temperature parameter is not supported"])("does not label unsupported parameters as model access failures: %s", raw => {
    expect(classifyAgentError(raw).category).toBe("unknown")
  })
  it.each([
    "The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account.",
    '400 invalid_request_error: {"error":{"message":"The model is not supported with this account"}}',
    "model gpt-6.1-sol is not supported",
  ])("recognizes model access rejection: %s", raw => {
    expect(classifyAgentError(raw)).toMatchObject({ category: "model_unavailable", raw })
    expect(classifyAgentError(raw).message).toContain("select a different model")
  })
  it("tags balance errors and appends a hint", () => {
    const r = classifyAgentError("insufficient balance")
    expect(r.category).toBe("balance")
    expect(r.message).toBe("insufficient balance — switch to a free model or add credits / an API key")
  })

  it("treats a 402 status as a balance problem", () => {
    expect(classifyAgentError('{"statusCode":402}').category).toBe("balance")
  })

  it("tags auth errors (401/403/unauthorized/invalid key)", () => {
    expect(classifyAgentError("unexpected status 401 Unauthorized").category).toBe("auth")
    expect(classifyAgentError("Invalid API key").category).toBe("auth")
    expect(classifyAgentError("403 Forbidden").category).toBe("auth")
  })

  it("tags unavailable-model errors", () => {
    expect(classifyAgentError('model "foo" is not available').category).toBe("model_unavailable")
  })

  it("tags rate-limit errors", () => {
    expect(classifyAgentError("Rate limit exceeded").category).toBe("rate_limit")
    expect(classifyAgentError("429 Too Many Requests").category).toBe("rate_limit")
  })

  it("tags network errors", () => {
    expect(classifyAgentError("ECONNREFUSED").category).toBe("network")
    expect(classifyAgentError("Connection failed").category).toBe("network")
  })

  it("passes unknown errors through unchanged with no hint", () => {
    const r = classifyAgentError("APIError")
    expect(r.category).toBe("unknown")
    expect(r.message).toBe("APIError")
  })

  it("preserves the original detail alongside the hint", () => {
    expect(classifyAgentError("Rate limit exceeded").message).toBe(
      "Rate limit exceeded — wait a moment and retry"
    )
  })
})

describe("resolveAgentError", () => {
  it("extracts and classifies in one step", () => {
    expect(resolveAgentError({ error: { data: { message: "Rate limit exceeded" } } })).toBe(
      "Rate limit exceeded — wait a moment and retry"
    )
  })

  it("surfaces the raw payload for an opaque error object instead of 'Unknown error'", () => {
    expect(resolveAgentError({ statusCode: 402 })).toBe(
      '{"statusCode":402} — switch to a free model or add credits / an API key'
    )
  })

  it("logs and returns a clear placeholder when nothing is extractable", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    const out = resolveAgentError({}, "opencode")
    expect(out).toBe("The agent reported an error without any details — check the agent logs.")
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})
