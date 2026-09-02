/**
 * Unit tests for the agent readiness/status logic behind the picker dot:
 * agentSharedPoolExhausted plus its effect on agentHasFreeUsage / agentIsReady.
 *
 * Pure functions — no mocks. The interesting case is the daily balance
 * allowance running out: the picker should show a red ("exhausted") dot, not
 * green — and it must do so for every shared pool, since the balance is pooled.
 */
import { describe, it, expect } from "vitest"
import {
  agentSharedPoolExhausted,
  agentHasFreeUsage,
  agentIsReady,
  hasCredentialsForModel,
  getFreeModelForAgent,
  modelRequiresKey,
  getAgentModels,
  type CredentialFlags,
} from "@background-agents/common"

const sharedPoolFresh: CredentialFlags = { CLAUDE_SHARED_POOL_AVAILABLE: true }
const sharedPoolUsedUp: CredentialFlags = {
  CLAUDE_SHARED_POOL_AVAILABLE: true,
  SHARED_BALANCE_EXHAUSTED: true,
}
const ownKeyButLimit: CredentialFlags = {
  CLAUDE_SHARED_POOL_AVAILABLE: true,
  SHARED_BALANCE_EXHAUSTED: true,
  ANTHROPIC_API_KEY: true,
}

describe("agentSharedPoolExhausted", () => {
  it("is true when the Claude shared pool is used up and there's no own key", () => {
    expect(agentSharedPoolExhausted("claude-code", sharedPoolUsedUp)).toBe(true)
  })

  it("is false when the shared pool still has budget", () => {
    expect(agentSharedPoolExhausted("claude-code", sharedPoolFresh)).toBe(false)
  })

  it("is false when the user has their own Anthropic key to fall back on", () => {
    expect(agentSharedPoolExhausted("claude-code", ownKeyButLimit)).toBe(false)
  })

  it("is false for agents with no shared pool at all", () => {
    // Kilo's free tier isn't a shared pool, so a spent balance doesn't touch it.
    expect(agentSharedPoolExhausted("kilo", sharedPoolUsedUp)).toBe(false)
    expect(agentSharedPoolExhausted("codex", sharedPoolUsedUp)).toBe(false)
  })

  it("closes the OpenCode and Gemini pools too, because the balance is pooled", () => {
    const allSharedSpent: CredentialFlags = {
      SHARED_BALANCE_EXHAUSTED: true,
      OPENCODE_API_KEY_SHARED: true,
      GEMINI_API_KEY_SHARED: true,
    }
    expect(agentSharedPoolExhausted("opencode", allSharedSpent)).toBe(true)
    expect(agentSharedPoolExhausted("gemini", allSharedSpent)).toBe(true)
  })

  it("leaves a pool open when the user brought their own key for it", () => {
    const ownOpencodeKey: CredentialFlags = {
      SHARED_BALANCE_EXHAUSTED: true,
      OPENCODE_API_KEY_USER: true,
    }
    expect(agentSharedPoolExhausted("opencode", ownOpencodeKey)).toBe(false)
  })
})

describe("readiness when the balance runs out", () => {
  it("no longer reports free usage (so the dot won't be green)", () => {
    expect(agentHasFreeUsage("claude-code", sharedPoolFresh)).toBe(true)
    expect(agentHasFreeUsage("claude-code", sharedPoolUsedUp)).toBe(false)
  })

  it("is not 'ready' when exhausted with no fallback credential", () => {
    expect(agentIsReady("claude-code", sharedPoolFresh)).toBe(true)
    expect(agentIsReady("claude-code", sharedPoolUsedUp)).toBe(false)
  })

  it("stays ready when the user has their own key despite the limit", () => {
    expect(agentIsReady("claude-code", ownKeyButLimit)).toBe(true)
  })
})

describe("shared Claude pool does not leak to non-claude-code agents", () => {
  // The shared pool / subscription token is only injected server-side for
  // claude-code (see resolveSendCredentials), so other agents' Claude models
  // must require a real ANTHROPIC_API_KEY — otherwise the picker shows a green
  // "ready" dot for an agent that would actually fail to run.
  const anthropicModel = { value: "claude-sonnet-4-5", label: "Sonnet", requiresKey: "anthropic" as const }

  it("does not treat goose as ready off the shared Claude pool alone", () => {
    expect(agentIsReady("goose", sharedPoolFresh)).toBe(false)
    expect(hasCredentialsForModel(anthropicModel, sharedPoolFresh, "goose")).toBe(false)
  })

  it("treats goose as ready once the user has their own Anthropic key", () => {
    expect(hasCredentialsForModel(anthropicModel, { ANTHROPIC_API_KEY: true }, "goose")).toBe(true)
    expect(agentIsReady("goose", { ANTHROPIC_API_KEY: true })).toBe(true)
  })

  it("still lets claude-code use the shared pool", () => {
    expect(hasCredentialsForModel(anthropicModel, sharedPoolFresh, "claude-code")).toBe(true)
  })
})

describe("shared Gemini pool unlocks Flash but not Pro", () => {
  // The server-shared Gemini key backs only the cheaper Flash tier for free
  // usage; Pro-tier Gemini models must stay locked until the user adds their
  // own key. This holds across every agent that exposes a Gemini model.
  const geminiShared: CredentialFlags = { GEMINI_API_KEY: true, GEMINI_API_KEY_SHARED: true }
  const geminiOwnKey: CredentialFlags = {
    GEMINI_API_KEY: true,
    GEMINI_API_KEY_USER: true,
  }
  const flash = { value: "gemini-2.5-flash", label: "Flash", requiresKey: "gemini" as const }
  const pro = { value: "gemini-3.1-pro-preview", label: "Pro", requiresKey: "gemini" as const }
  const piPro = { value: "google/gemini-3.1-pro-preview", label: "Pro", requiresKey: "gemini" as const }

  it("allows Flash models on the shared pool", () => {
    expect(hasCredentialsForModel(flash, geminiShared, "gemini")).toBe(true)
  })

  it("blocks Pro models on the shared pool across agents", () => {
    expect(hasCredentialsForModel(pro, geminiShared, "gemini")).toBe(false)
    expect(hasCredentialsForModel(pro, geminiShared, "droid")).toBe(false)
    expect(hasCredentialsForModel(piPro, geminiShared, "pi")).toBe(false)
  })

  it("unlocks Pro once the user brings their own Gemini key", () => {
    expect(hasCredentialsForModel(pro, geminiOwnKey, "gemini")).toBe(true)
    expect(hasCredentialsForModel(piPro, geminiOwnKey, "pi")).toBe(true)
  })
})

describe("free models survive a spent balance", () => {
  // The escape hatch: with the balance gone, OpenCode's free tier is what a
  // user is told to switch to. Two separate gates have to agree on that — the
  // picker (hasCredentialsForModel) and the send path (checkSharedPoolUsage,
  // which keys on modelRequiresKey). If they drift, the UI offers a model the
  // server then 429s, and "Continue with OpenCode" loops.
  const spentWithSharedOpencode: CredentialFlags = {
    SHARED_BALANCE_EXHAUSTED: true,
    OPENCODE_API_KEY: true,
    OPENCODE_API_KEY_SHARED: true,
  }

  const freeModels = getAgentModels("opencode").filter(
    (m) => m.requiresKey === "none"
  )

  it("has free OpenCode models to fall back to", () => {
    expect(freeModels.length).toBeGreaterThan(0)
    expect(getFreeModelForAgent("opencode")).toBe(freeModels[0].value)
  })

  it("keeps every free model selectable in the picker", () => {
    for (const m of freeModels) {
      expect(hasCredentialsForModel(m, spentWithSharedOpencode, "opencode")).toBe(true)
    }
  })

  it("marks them as needing no key, which is what the send path checks", () => {
    for (const m of freeModels) {
      expect(modelRequiresKey("opencode", m.value)).toBe("none")
    }
  })

  it("still blocks the paid shared models", () => {
    const paid = { value: "opencode-go/mimo-v2.5-pro", label: "MiMo", requiresKey: "opencode" as const }
    expect(hasCredentialsForModel(paid, spentWithSharedOpencode, "opencode")).toBe(false)
    expect(modelRequiresKey("opencode", paid.value)).toBe("opencode")
  })
})
