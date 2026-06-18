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

  it("surfaces a bare HTTP status code when there is no message/name", () => {
    // An error event whose only machine-readable signal is the status code.
    // Previously collapsed to "Unknown error", then to a raw JSON dump; now it
    // surfaces a clean "HTTP <code>" that classifyAgentError can still bucket.
    expect(extractErrorMessage({ statusCode: 402, providerID: "opencode" })).toBe("HTTP 402")
  })

  it("preserves an HTTP status alongside a name so the category survives", () => {
    // OpenCode emits this shape on a rate limit: a name but no message, with the
    // 429 tucked in data.statusCode. The name must not eclipse the 429.
    expect(
      extractErrorMessage({ name: "ProviderError", data: { statusCode: 429 } })
    ).toBe("ProviderError (HTTP 429)")
  })

  it("does not append a status that the message already states", () => {
    expect(
      extractErrorMessage({ message: "429 Too Many Requests", statusCode: 429 })
    ).toBe("429 Too Many Requests")
  })

  it("ignores numeric fields that are not plausible HTTP statuses", () => {
    // A non-HTTP numeric `code` (e.g. a process exit code) must not be treated
    // as a status and appended.
    expect(extractErrorMessage({ name: "Boom", code: 1 })).toBe("Boom")
  })

  it("returns empty string for an empty object", () => {
    expect(extractErrorMessage({})).toBe("")
  })
})

describe("classifyAgentError", () => {
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

  it("classifies a status-only error instead of returning 'Unknown error'", () => {
    expect(resolveAgentError({ statusCode: 402 })).toBe(
      "HTTP 402 — switch to a free model or add credits / an API key"
    )
  })

  it("classifies a rate limit emitted as name + data.statusCode (OpenCode shape)", () => {
    expect(
      resolveAgentError({ name: "ProviderError", data: { statusCode: 429 } }, "opencode")
    ).toBe("ProviderError (HTTP 429) — wait a moment and retry")
  })

  it("logs and returns a clear placeholder when nothing is extractable", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    const out = resolveAgentError({}, "opencode")
    expect(out).toBe("The agent reported an error without any details — check the agent logs.")
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})
