/** Browser-safe thinking levels per agent/model. No provider credentials or Node imports. */
import { piModelIdentity } from "./agents/pi/model-identity"

const THINKING_LEVELS = ["default", "none", "off", "on", "adaptive", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"] as const
export type ThinkingLevel = typeof THINKING_LEVELS[number]

export interface ThinkingCapability {
  readonly levels: readonly ThinkingLevel[]
  readonly control?: "codex-config" | "claude-effort" | "commandcode-effort" | "copilot-effort" | "droid-effort" | "pi-thinking" | "kimi-env"
}

const basic = ["low", "medium", "high"] as const
const extended = [...basic, "xhigh", "max"] as const
const none: ThinkingCapability = { levels: [] }

/**
 * Hardcoded like the model lists: the chosen level is passed straight to the
 * CLI without validation, and the CLI decides what to do with it. Agents whose
 * levels vary per model (OpenCode, Kilo) or need a config file (Gemini) only
 * offer Default for now.
 */
function expectedThinkingCapability(agent: string, model?: string): ThinkingCapability {
  if (!model || model.startsWith("endpoint:")) return none
  if (agent === "codex") {
    if (["gpt-6.1-sol", "gpt-6-astra", "gpt-6-sol"].includes(model)) return { levels: [...extended, "ultra"], control: "codex-config" }
    if (model === "gpt-6-luna") return { levels: extended, control: "codex-config" }
    if (model === "gpt-5.5") return { levels: [...basic, "xhigh"], control: "codex-config" }
  }
  if (agent === "claude") {
    // Aliases can resolve to different releases, so they only offer the levels
    // every release supports.
    if (["sonnet", "opus"].includes(model) || /^claude-(opus|sonnet)-4-6(?:-\d{8})?$/.test(model)) {
      return { levels: [...basic, "max"], control: "claude-effort" }
    }
    if (model === "fable" || /^claude-(?:fable-5(?:-1)?|opus-(?:4-[78]|5(?:-5)?)|sonnet-5(?:-5)?|haiku-5-5)$/.test(model)) {
      return { levels: extended, control: "claude-effort" }
    }
  }
  if (agent === "commandcode" || agent === "copilot") {
    // These gateways have their own catalogs; don't inherit Codex's ultra.
    const id = model.replaceAll(".", "-")
    const claude = /^claude-(?:fable-5(?:-1)?|opus-(?:4-[78]|5(?:-5)?)|sonnet-5(?:-5)?|haiku-5-5)$/.test(id)
    const openai = /^gpt-(?:6(?:-1)?-(?:sol|astra|luna)|5-6-(?:sol|terra|luna))$/.test(id)
    const older = /^gpt-5-(?:3-codex|4|5)$/.test(id)
    if (claude || openai || older) return { levels: older ? [...basic, "xhigh"] : extended, control: agent === "copilot" ? "copilot-effort" : "commandcode-effort" }
  }
  if (agent === "droid" && model.startsWith("factory/")) {
    // Droid's reasoning flag only applies to Factory-hosted models, not BYOK.
    const id = model.slice(8)
    const levels: readonly ThinkingLevel[] | undefined =
      ["gpt-6.1-sol", "gpt-6-astra", "claude-opus-5-5"].includes(id) ? extended :
      ["gpt-6-sol", "gpt-6-luna", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"].includes(id) ? ["none", ...extended] :
      ["claude-fable-5", "claude-fable-5.1", "claude-opus-4-8", "claude-opus-4-7", "claude-opus-5", "claude-sonnet-5", "claude-sonnet-5-5"].includes(id) ? ["off", ...extended] :
      ["claude-sonnet-4-6", "claude-opus-4-6"].includes(id) ? ["off", ...basic, "max"] :
      ["gemini-3.8-flash", "gemini-3.1-pro-preview"].includes(id) ? basic :
      ["gemini-3.5-flash", "gemini-3-flash-preview"].includes(id) ? ["minimal", ...basic] :
      id === "glm-5.2" ? ["off", "high", "max"] : undefined
    if (levels) return { levels, control: "droid-effort" }
  }
  if (agent === "pi" && piModelIdentity(model)) {
    return { levels: ["off", "minimal", ...extended], control: "pi-thinking" }
  }
  // K2.5/K2.6 have an on/off switch, not effort levels. K2.7 always thinks.
  if (agent === "kimi" && ["kimi-k2.5", "kimi-k2.6"].includes(model)) return { levels: ["on", "off"], control: "kimi-env" }
  // Eliza is a fake, regex-based test agent with no real thinking flag to
  // forward — this exists only so the composer has something to exercise
  // the thinking selector against. No `control`, since buildCommand() never
  // calls thinkingArgs(): whatever level is picked here is silently ignored.
  if (agent === "eliza") return { levels: extended }
  return none
}

export function getThinkingCapability(agent: string, model?: string): ThinkingCapability {
  return expectedThinkingCapability(agent, model)
}

export function supportsThinking(capability: ThinkingCapability, value: string): value is ThinkingLevel {
  return value === "default" || capability.levels.some(level => level === value)
}

export function thinkingLabel(value: string): string {
  return value === "xhigh" ? "Extra high" : value[0].toUpperCase() + value.slice(1)
}

/** Default sends no flag, so the CLI keeps its own setting. */
export function thinkingArgs(agent: string, model: string | undefined, value: unknown): string[] {
  if (typeof value !== "string" || value === "default") return []
  switch (getThinkingCapability(agent, model).control) {
    case "codex-config": return ["-c", `model_reasoning_effort=${JSON.stringify(value)}`]
    case "claude-effort": return ["--effort", value]
    case "commandcode-effort": return ["--effort", value]
    case "copilot-effort":
    case "droid-effort": return ["--reasoning-effort", value]
    case "pi-thinking": return ["--thinking", value]
    default: return []
  }
}
