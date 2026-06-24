/**
 * Unit tests for the custom OpenAI-compatible OpenCode endpoint ("OpenCode"
 * target on the Custom model tab).
 *
 * Two layers:
 *  - pure credential/model logic in @background-agents/common (env passthrough,
 *    model resolution to `custom/<model>`, the credential gate)
 *  - the SDK's opencode.json generation (buildOpencodeConfigJson)
 */
import { describe, it, expect } from "vitest"
import {
  getEnvForModel,
  buildOpencodeCustomEnv,
  resolveCliModel,
  ENDPOINT_MODEL_PREFIX,
  type CustomEndpoint,
} from "@background-agents/common"
import { buildOpencodeConfigJson } from "../../src/agents/opencode/config"

function ep(overrides: Partial<CustomEndpoint> = {}): CustomEndpoint {
  return { id: "o1", name: "My OpenCode", type: "opencode", baseUrl: "", model: "", headers: "", ...overrides }
}

const MODEL = ENDPOINT_MODEL_PREFIX + "o1"

describe("buildOpencodeCustomEnv / getEnvForModel", () => {
  it("promotes the Authorization token (Bearer stripped) to CUSTOM_OPENCODE_API_KEY", () => {
    const endpoint = ep({
      baseUrl: "https://gw.example.com/v1",
      headers: "Authorization: Bearer tok-1",
      model: "gpt-4o-mini",
    })
    const env = getEnvForModel(MODEL, "opencode", {}, [endpoint])
    expect(env).toEqual({
      CUSTOM_OPENCODE_BASE_URL: "https://gw.example.com/v1",
      CUSTOM_OPENCODE_HEADERS: "Authorization: Bearer tok-1",
      CUSTOM_OPENCODE_NAME: "gpt-4o-mini",
      CUSTOM_OPENCODE_API_KEY: "tok-1",
    })
  })

  it("never leaks a stored OpenCode key into a custom run", () => {
    const env = getEnvForModel(MODEL, "opencode", { OPENCODE_API_KEY: "sk-SHOULD_NOT_LEAK" }, [
      ep({ baseUrl: "https://gw.example.com/v1" }),
    ])
    expect(env.OPENCODE_API_KEY).toBeUndefined()
    expect(env.CUSTOM_OPENCODE_BASE_URL).toBe("https://gw.example.com/v1")
  })

  it("leaves CUSTOM_OPENCODE_API_KEY unset when no Authorization header is given", () => {
    const env = buildOpencodeCustomEnv(
      ep({ baseUrl: "https://gw.example.com/v1", headers: "x-api-key: sk-1" })
    )
    expect(env.CUSTOM_OPENCODE_API_KEY).toBeUndefined()
    expect(env.CUSTOM_OPENCODE_HEADERS).toBe("x-api-key: sk-1")
  })
})

describe("resolveCliModel — opencode custom", () => {
  it("maps an endpoint model value to custom/<model id>", () => {
    expect(resolveCliModel(MODEL, [ep({ model: "gpt-4o-mini" })])).toBe("custom/gpt-4o-mini")
  })

  it("returns undefined when no model id is set", () => {
    expect(resolveCliModel(MODEL, [ep()])).toBeUndefined()
  })
})

describe("buildOpencodeConfigJson", () => {
  it("emits an openai-compatible provider with baseURL, apiKey env ref, and model map", () => {
    const json = JSON.parse(
      buildOpencodeConfigJson({
        baseUrl: "https://openrouter.ai/api/v1",
        model: "gpt-4o-mini",
        headers: "Authorization: Bearer tok-1\nX-Title: my-app",
        apiKeyEnv: "CUSTOM_OPENCODE_API_KEY",
      })
    )
    const provider = json.provider.custom
    expect(provider.npm).toBe("@ai-sdk/openai-compatible")
    expect(provider.options.baseURL).toBe("https://openrouter.ai/api/v1")
    expect(provider.options.apiKey).toBe("{env:CUSTOM_OPENCODE_API_KEY}")
    // Authorization is carried by apiKey; only non-auth headers stay in headers.
    expect(provider.options.headers).toEqual({ "X-Title": "my-app" })
    expect(provider.models["gpt-4o-mini"]).toEqual({ name: "gpt-4o-mini" })
  })

  it("omits apiKey and headers when none are configured", () => {
    const json = JSON.parse(
      buildOpencodeConfigJson({ baseUrl: "https://gw.example.com/v1", model: "m1" })
    )
    const opts = json.provider.custom.options
    expect(opts.apiKey).toBeUndefined()
    expect(opts.headers).toBeUndefined()
    expect(opts.baseURL).toBe("https://gw.example.com/v1")
  })

  it("never writes the literal token into the file", () => {
    const out = buildOpencodeConfigJson({
      baseUrl: "https://gw.example.com/v1",
      model: "m1",
      headers: "Authorization: Bearer super-secret",
      apiKeyEnv: "CUSTOM_OPENCODE_API_KEY",
    })
    expect(out).not.toContain("super-secret")
  })
})
