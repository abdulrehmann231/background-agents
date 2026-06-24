/**
 * Unit tests for an Anthropic-type custom endpoint.
 *
 * Covers the mapping of a CustomEndpoint to the standard ANTHROPIC_* env vars,
 * header parsing / auth promotion, CLI model resolution, and that an endpoint
 * option is always usable — all pure logic in @background-agents/common.
 */
import { describe, it, expect } from "vitest"
import {
  getEnvForModel,
  buildCustomModelEnv,
  parseCustomHeaders,
  resolveCliModel,
  hasCredentialsForModel,
  getAgentModels,
  ENDPOINT_MODEL_PREFIX,
  type CustomEndpoint,
} from "@background-agents/common"

function ep(overrides: Partial<CustomEndpoint> = {}): CustomEndpoint {
  return {
    id: "e1",
    name: "My Anthropic",
    type: "anthropic",
    baseUrl: "",
    model: "",
    headers: "",
    ...overrides,
  }
}

const MODEL = ENDPOINT_MODEL_PREFIX + "e1"

describe("custom model env injection", () => {
  it("promotes an x-api-key header to ANTHROPIC_API_KEY", () => {
    const endpoint = ep({
      baseUrl: "https://api.anthropic.com",
      headers: "x-api-key: sk-ant-123",
    })
    const env = getEnvForModel(MODEL, "claude-code", {}, [endpoint])
    expect(env).toEqual({
      ANTHROPIC_BASE_URL: "https://api.anthropic.com",
      ANTHROPIC_API_KEY: "sk-ant-123",
    })
  })

  it("promotes an Authorization header to ANTHROPIC_AUTH_TOKEN (Bearer stripped)", () => {
    const env = buildCustomModelEnv(
      ep({ baseUrl: "https://gateway.example.com", headers: "Authorization: Bearer tok-456" })
    )
    expect(env).toEqual({
      ANTHROPIC_BASE_URL: "https://gateway.example.com",
      ANTHROPIC_AUTH_TOKEN: "tok-456",
    })
  })

  it("never leaks the shared-pool token even if one is stored", () => {
    const env = getEnvForModel(
      MODEL,
      "claude-code",
      { CLAUDE_CODE_CREDENTIALS: '{"claudeAiOauth":{"accessToken":"SHOULD_NOT_LEAK"}}' },
      [ep({ baseUrl: "https://gateway.example.com", headers: "x-api-key: sk-custom" })]
    )
    expect(env.CLAUDE_CODE_CREDENTIALS).toBeUndefined()
    expect(env.ANTHROPIC_API_KEY).toBe("sk-custom")
  })

  it("keeps non-auth headers in ANTHROPIC_CUSTOM_HEADERS alongside promoted auth", () => {
    const env = buildCustomModelEnv(
      ep({
        baseUrl: "https://gateway.example.com",
        headers: "x-org-id: org_1\nx-api-key: sk-custom\nx-route: prod",
      })
    )
    expect(env.ANTHROPIC_API_KEY).toBe("sk-custom")
    expect(env.ANTHROPIC_CUSTOM_HEADERS).toBe("x-org-id: org_1\nx-route: prod")
  })

  it("only sets the base URL when no headers are configured", () => {
    const env = buildCustomModelEnv(ep({ baseUrl: "https://api.anthropic.com" }))
    expect(env).toEqual({ ANTHROPIC_BASE_URL: "https://api.anthropic.com" })
  })
})

describe("parseCustomHeaders", () => {
  it("extracts auth headers, drops anthropic-version, and keeps the rest", () => {
    const parsed = parseCustomHeaders(
      "x-a: 1\n\nx-api-key: sk-1\nbadline\nanthropic-version: 1\nAuthorization: Bearer tok\nx-b: 2"
    )
    expect(parsed).toEqual({
      apiKey: "sk-1",
      authToken: "tok",
      headers: "x-a: 1\nx-b: 2",
    })
  })

  it("returns no headers blob when only auth lines remain", () => {
    expect(parseCustomHeaders("Authorization: Bearer x\n\n")).toEqual({
      authToken: "x",
      apiKey: undefined,
      headers: undefined,
    })
  })

  it("accepts an Authorization value without a Bearer prefix", () => {
    expect(parseCustomHeaders("Authorization: tok-raw").authToken).toBe("tok-raw")
  })
})

describe("resolveCliModel", () => {
  it("translates an endpoint model value to its configured model name", () => {
    expect(resolveCliModel(MODEL, [ep({ model: "claude-opus-4-1" })])).toBe("claude-opus-4-1")
  })

  it("returns undefined for an endpoint with no model name (endpoint default)", () => {
    expect(resolveCliModel(MODEL, [ep()])).toBeUndefined()
  })

  it("passes regular model values through unchanged", () => {
    expect(resolveCliModel("sonnet", [])).toBe("sonnet")
  })
})

describe("getAgentModels / hasCredentialsForModel — endpoints", () => {
  it("merges an anthropic endpoint into claude-code's list, available without a key", () => {
    const models = getAgentModels("claude-code", [ep({ name: "My Anthropic" })])
    const option = models.find((m) => m.value === MODEL)
    expect(option).toMatchObject({ value: MODEL, label: "My Anthropic", requiresKey: "none" })
    expect(hasCredentialsForModel(option!, {}, "claude-code")).toBe(true)
  })

  it("only lists an endpoint under the agent its type maps to", () => {
    const endpoints = [ep()]
    expect(getAgentModels("codex", endpoints).some((m) => m.value === MODEL)).toBe(false)
    expect(getAgentModels("opencode", endpoints).some((m) => m.value === MODEL)).toBe(false)
  })
})
