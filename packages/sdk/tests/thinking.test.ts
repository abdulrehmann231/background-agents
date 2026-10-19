import { describe, expect, it } from "vitest"
import { claudeAgent } from "../src/agents/claude"
import { codexAgent } from "../src/agents/codex"
import { commandCodeAgent } from "../src/agents/commandcode"
import { copilotAgent } from "../src/agents/copilot"
import { droidAgent } from "../src/agents/droid"
import { geminiAgent } from "../src/agents/gemini"
import { kimiAgent } from "../src/agents/kimi"
import { opencodeAgent } from "../src/agents/opencode"
import { piAgent } from "../src/agents/pi"
import { getThinkingCapability } from "../src/thinking"

describe("per-turn thinking", () => {
  it.each([
    [codexAgent, "gpt-6.1-sol", 'model_reasoning_effort="high"'],
    [claudeAgent, "sonnet", "--effort high"],
    [commandCodeAgent, "gpt-6-luna", "--effort high"],
    [copilotAgent, "gpt-6-luna", "--reasoning-effort high"],
    [droidAgent, "factory/gpt-6-luna", "--reasoning-effort high"],
    [piAgent, "claude-opus-5", "--thinking high"],
  ])("passes %#'s level to its CLI flag, and Default sends none", (agent, model, flag) => {
    // Some adapters build a shell string with quoted args; compare unquoted.
    const command = (thinking: string) => agent.buildCommand({ model, prompt: "hello", thinking }).args.join(" ").replaceAll("'", "")
    expect(command("high")).toContain(flag)
    expect(command("default")).not.toContain(flag.split(" ")[0])
  })

  it("keeps Claude's effort separate from plan mode", () => {
    const args = claudeAgent.buildCommand({ model: "sonnet", prompt: "hello", planMode: true, thinking: "high" }).args
    expect(args).toEqual(expect.arrayContaining(["--effort", "high", "--permission-mode", "plan"]))
  })

  it("sets Kimi's on/off through the process env only", () => {
    expect(kimiAgent.buildCommand({ model: "kimi-k2.5", prompt: "hello", thinking: "off" }).env?.KIMI_MODEL_THINKING_EFFORT).toBe("off")
    expect(kimiAgent.buildCommand({ model: "kimi-k2.5", prompt: "hello" }).env?.KIMI_MODEL_THINKING_EFFORT).toBeUndefined()
  })

  it("offers no levels and sends no flag for Default-only agents", () => {
    for (const [agent, model] of [["opencode", "opencode/big-pickle"], ["kilo", "anthropic/claude-sonnet-5"], ["gemini", "gemini-3.6-flash"], ["goose", "gpt-6-luna"]]) {
      expect(getThinkingCapability(agent, model).levels).toEqual([])
    }
    expect(opencodeAgent.buildCommand({ model: "opencode/big-pickle", prompt: "hello", thinking: "high" }).args.join(" ")).not.toContain("--variant")
    expect(geminiAgent.buildCommand({ model: "gemini-3.6-flash", prompt: "hello", thinking: "high" }).cmd).toBe("gemini")
  })

  it("qualifies Pi's bare Claude IDs the same way for levels and --model", () => {
    expect(getThinkingCapability("pi", "claude-opus-5").levels).toContain("high")
    expect(piAgent.buildCommand({ model: "claude-opus-5", prompt: "hello" }).args).toEqual(expect.arrayContaining(["--model", "anthropic/claude-opus-5"]))
  })
})
