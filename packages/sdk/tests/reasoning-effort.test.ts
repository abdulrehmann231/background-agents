import { describe, expect, it } from "vitest"
import { claudeAgent } from "../src/agents/claude"
import { codexAgent } from "../src/agents/codex"
import { commandCodeAgent } from "../src/agents/commandcode"
import { copilotAgent } from "../src/agents/copilot"
import { droidAgent } from "../src/agents/droid"
import { elizaAgent } from "../src/agents/eliza"
import { geminiAgent } from "../src/agents/gemini"
import { kimiAgent } from "../src/agents/kimi"
import { opencodeAgent } from "../src/agents/opencode"
import { piAgent } from "../src/agents/pi"
import { getReasoningEffortCapability } from "../src/reasoning-effort"

describe("per-turn reasoning effort", () => {
  it.each([
    [codexAgent, "gpt-6.1-sol", 'model_reasoning_effort="high"'],
    [claudeAgent, "sonnet", "--effort high"],
    [commandCodeAgent, "gpt-6-luna", "--effort high"],
    [copilotAgent, "gpt-6-luna", "--reasoning-effort high"],
    [droidAgent, "factory/gpt-6-luna", "--reasoning-effort high"],
    [piAgent, "claude-opus-5", "--thinking high"],
  ])("passes %#'s level to its CLI flag, and Default sends none", (agent, model, flag) => {
    // Some adapters build a shell string with quoted args; compare unquoted.
    const command = (reasoningEffort: string) => agent.buildCommand({ model, prompt: "hello", reasoningEffort }).args.join(" ").replaceAll("'", "")
    expect(command("high")).toContain(flag)
    expect(command("default")).not.toContain(flag.split(" ")[0])
  })

  it("keeps Claude's effort separate from plan mode", () => {
    const args = claudeAgent.buildCommand({ model: "sonnet", prompt: "hello", planMode: true, reasoningEffort: "high" }).args
    expect(args).toEqual(expect.arrayContaining(["--effort", "high", "--permission-mode", "plan"]))
  })

  it("sets Kimi's on/off through the process env only", () => {
    expect(kimiAgent.buildCommand({ model: "kimi-k2.5", prompt: "hello", reasoningEffort: "off" }).env?.KIMI_MODEL_THINKING_EFFORT).toBe("off")
    expect(kimiAgent.buildCommand({ model: "kimi-k2.5", prompt: "hello" }).env?.KIMI_MODEL_THINKING_EFFORT).toBeUndefined()
  })

  it("offers no levels and sends no flag for Default-only agents", () => {
    for (const [agent, model] of [["opencode", "opencode/big-pickle"], ["kilo", "anthropic/claude-sonnet-5"], ["gemini", "gemini-3.6-flash"], ["goose", "gpt-6-luna"]]) {
      expect(getReasoningEffortCapability(agent, model).levels).toEqual([])
    }
    expect(opencodeAgent.buildCommand({ model: "opencode/big-pickle", prompt: "hello", reasoningEffort: "high" }).args.join(" ")).not.toContain("--variant")
    expect(geminiAgent.buildCommand({ model: "gemini-3.6-flash", prompt: "hello", reasoningEffort: "high" }).cmd).toBe("gemini")
  })

  it("qualifies Pi's bare Claude IDs the same way for levels and --model", () => {
    expect(getReasoningEffortCapability("pi", "claude-opus-5").levels).toContain("high")
    expect(piAgent.buildCommand({ model: "claude-opus-5", prompt: "hello" }).args).toEqual(expect.arrayContaining(["--model", "anthropic/claude-opus-5"]))
  })

  it("offers Eliza levels for the UI to render, but its CLI command ignores whatever is picked", () => {
    expect(getReasoningEffortCapability("eliza", "eliza-classic-1.0").levels).toEqual(["low", "medium", "high", "xhigh", "max"])
    const withEffort = elizaAgent.buildCommand({ model: "eliza-classic-1.0", prompt: "hello", reasoningEffort: "max" })
    const withoutEffort = elizaAgent.buildCommand({ model: "eliza-classic-1.0", prompt: "hello" })
    expect(withEffort).toEqual(withoutEffort)
  })
})
