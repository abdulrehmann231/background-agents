/** Browser-safe reasoning-effort levels per agent/model. No provider credentials or Node imports. */
import { piModelIdentity } from "./agents/pi/model-identity"

const REASONING_EFFORT_LEVELS = ["default", "none", "off", "on", "adaptive", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"] as const
export type ReasoningEffortLevel = typeof REASONING_EFFORT_LEVELS[number]

export interface ReasoningEffortCapability {
  readonly levels: readonly ReasoningEffortLevel[]
  readonly control?: "codex-config" | "claude-effort" | "commandcode-effort" | "copilot-effort" | "droid-effort" | "pi-thinking" | "kimi-env"
  /**
   * The level the underlying CLI actually uses when no override is passed.
   * Always one of `levels` (or undefined when `levels` is empty). The UI
   * preselects this instead of showing a separate "Default" menu entry, so
   * the user sees the true default up front rather than an opaque label.
   */
  readonly defaultLevel?: ReasoningEffortLevel
  /**
   * How sure we are that `defaultLevel` matches the CLI's real behavior.
   * "confirmed" means an official doc/changelog states it explicitly;
   * "guess" means it's inferred (e.g. from a sibling model family or a
   * forum/blog mention) and could be wrong. Only meaningful when
   * `defaultLevel` is set.
   */
  readonly defaultLevelConfidence?: "confirmed" | "guess"
}

const basic = ["low", "medium", "high"] as const
const extended = [...basic, "xhigh", "max"] as const
const none: ReasoningEffortCapability = { levels: [] }

/**
 * Hardcoded like the model lists: the chosen level is passed straight to the
 * CLI without validation, and the CLI decides what to do with it. Agents whose
 * levels vary per model (OpenCode, Kilo) or need a config file (Gemini) only
 * offer Default for now.
 */
function expectedReasoningEffortCapability(agent: string, model?: string): ReasoningEffortCapability {
  if (!model || model.startsWith("endpoint:")) return none
  if (agent === "codex") {
    if (["gpt-6.1-sol", "gpt-6-astra", "gpt-6-sol"].includes(model)) return { levels: [...extended, "ultra"], control: "codex-config", defaultLevel: "medium", defaultLevelConfidence: "confirmed" }
    if (model === "gpt-6-luna") return { levels: extended, control: "codex-config", defaultLevel: "medium", defaultLevelConfidence: "confirmed" }
    if (model === "gpt-5.5") return { levels: [...basic, "xhigh"], control: "codex-config", defaultLevel: "medium", defaultLevelConfidence: "confirmed" }
  }
  if (agent === "claude") {
    // Aliases can resolve to different releases, so they only offer the levels
    // every release supports.
    if (["sonnet", "opus"].includes(model) || /^claude-(opus|sonnet)-4-6(?:-\d{8})?$/.test(model)) {
      // Confirmed by Anthropic's release notes (Opus 4.6 moved high -> medium).
      return { levels: [...basic, "max"], control: "claude-effort", defaultLevel: "medium", defaultLevelConfidence: "confirmed" }
    }
    if (model === "fable" || /^claude-(?:fable-5(?:-1)?|opus-(?:4-[78]|5(?:-5)?)|sonnet-5(?:-5)?|haiku-5-5)$/.test(model)) {
      // No release notes found for these specific models; assumed to follow
      // the same "medium" convention as the confirmed 4.6 generation.
      return { levels: extended, control: "claude-effort", defaultLevel: "medium", defaultLevelConfidence: "guess" }
    }
  }
  if (agent === "commandcode" || agent === "copilot") {
    // These gateways have their own catalogs; don't inherit Codex's ultra.
    const id = model.replaceAll(".", "-")
    const claude = /^claude-(?:fable-5(?:-1)?|opus-(?:4-[78]|5(?:-5)?)|sonnet-5(?:-5)?|haiku-5-5)$/.test(id)
    const openai = /^gpt-(?:6(?:-1)?-(?:sol|astra|luna)|5-6-(?:sol|terra|luna))$/.test(id)
    const older = /^gpt-5-(?:3-codex|4|5)$/.test(id)
    if (claude || openai || older) {
      // Not explicitly documented for these gateways; "medium" is inferred
      // from the underlying model families they proxy.
      return { levels: older ? [...basic, "xhigh"] : extended, control: agent === "copilot" ? "copilot-effort" : "commandcode-effort", defaultLevel: "medium", defaultLevelConfidence: "guess" }
    }
  }
  if (agent === "droid" && model.startsWith("factory/")) {
    // Droid's reasoning flag only applies to Factory-hosted models, not BYOK.
    const id = model.slice(8)
    // Factory docs: GPT-hosted models start on "medium"; Anthropic-hosted
    // models default to "off" (no extended thinking unless requested).
    // Gemini/GLM defaults aren't documented; the lowest offered level is the
    // closest approximation of their out-of-the-box behavior.
    const levels: readonly ReasoningEffortLevel[] | undefined =
      ["gpt-6.1-sol", "gpt-6-astra", "claude-opus-5-5"].includes(id) ? extended :
      ["gpt-6-sol", "gpt-6-luna", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"].includes(id) ? ["none", ...extended] :
      ["claude-fable-5", "claude-fable-5.1", "claude-opus-4-8", "claude-opus-4-7", "claude-opus-5", "claude-sonnet-5", "claude-sonnet-5-5"].includes(id) ? ["off", ...extended] :
      ["claude-sonnet-4-6", "claude-opus-4-6"].includes(id) ? ["off", ...basic, "max"] :
      ["gemini-3.8-flash", "gemini-3.1-pro-preview"].includes(id) ? basic :
      ["gemini-3.5-flash", "gemini-3-flash-preview"].includes(id) ? ["minimal", ...basic] :
      id === "glm-5.2" ? ["off", "high", "max"] : undefined
    if (levels) {
      const isClaude = id.startsWith("claude-")
      const isGpt = id.startsWith("gpt-")
      const defaultLevel = isClaude ? "off" : isGpt ? "medium" : levels[0]
      // Factory's docs explicitly state the GPT/Claude split; Gemini and GLM
      // defaults are our own approximation (lowest offered level).
      const defaultLevelConfidence = isClaude || isGpt ? "confirmed" : "guess"
      return { levels, control: "droid-effort", defaultLevel, defaultLevelConfidence }
    }
  }
  if (agent === "pi" && piModelIdentity(model)) {
    // Not officially documented; inferred from a description of `/thinking`
    // with no argument as a "balanced default".
    return { levels: ["off", "minimal", ...extended], control: "pi-thinking", defaultLevel: "medium", defaultLevelConfidence: "guess" }
  }
  // K2.5/K2.6 have an on/off switch, not effort levels. K2.7 always thinks.
  if (agent === "kimi" && ["kimi-k2.5", "kimi-k2.6"].includes(model)) {
    // Inferred from K2.5/K2.6 being described as thinking-by-default hybrid
    // models; no CLI-specific doc confirms it.
    return { levels: ["on", "off"], control: "kimi-env", defaultLevel: "on", defaultLevelConfidence: "guess" }
  }
  // Eliza is a fake, regex-based test agent with no real reasoning-effort flag
  // to forward — this exists only so the composer has something to exercise
  // the selector against. No `control`, since buildCommand() never calls
  // reasoningEffortArgs(): whatever level is picked here is silently ignored.
  if (agent === "eliza") return { levels: extended, defaultLevel: "medium", defaultLevelConfidence: "confirmed" }
  return none
}

export function getReasoningEffortCapability(agent: string, model?: string): ReasoningEffortCapability {
  return expectedReasoningEffortCapability(agent, model)
}

export function supportsReasoningEffort(capability: ReasoningEffortCapability, value: string): value is ReasoningEffortLevel {
  return value === "default" || capability.levels.some(level => level === value)
}

export function reasoningEffortLabel(value: string): string {
  return value === "xhigh" ? "Extra high" : value[0].toUpperCase() + value.slice(1)
}

/** Default sends no flag, so the CLI keeps its own setting. */
export function reasoningEffortArgs(agent: string, model: string | undefined, value: unknown): string[] {
  if (typeof value !== "string" || value === "default") return []
  switch (getReasoningEffortCapability(agent, model).control) {
    case "codex-config": return ["-c", `model_reasoning_effort=${JSON.stringify(value)}`]
    case "claude-effort": return ["--effort", value]
    case "commandcode-effort": return ["--effort", value]
    case "copilot-effort":
    case "droid-effort": return ["--reasoning-effort", value]
    case "pi-thinking": return ["--thinking", value]
    default: return []
  }
}
