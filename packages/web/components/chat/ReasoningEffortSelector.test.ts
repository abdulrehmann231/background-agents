import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import type { ReasoningEffortCapability } from "@background-agents/sdk/reasoning-effort"
import { ReasoningEffortSelector } from "./ReasoningEffortSelector"

function render(capability: ReasoningEffortCapability, value = "default") {
  return renderToStaticMarkup(createElement(ReasoningEffortSelector, { capability, value, onChange: vi.fn() }))
}

describe("ReasoningEffortSelector", () => {
  it("is hidden for models without adjustable levels", () => {
    expect(render({ levels: [] })).toBe("")
  })

  it("shows the selected level with the explanation", () => {
    const html = render({ levels: ["low", "high"], control: "claude-effort", defaultLevel: "low" }, "high")
    expect(html).toContain('aria-label="Reasoning effort"')
    expect(html).toContain("this agent and model&#x27;s own default")
  })

  it("flags an unconfirmed default with its own tooltip on the trigger", () => {
    const capability: ReasoningEffortCapability = { levels: ["low", "high"], control: "claude-effort", defaultLevel: "low", defaultLevelConfidence: "guess" }
    const atDefault = render(capability, "low")
    expect(atDefault).toContain("doesn&#x27;t document it explicitly")

    // Explicitly picking a non-default level drops the uncertainty messaging
    // from the trigger; the dropdown list (only rendered once opened, so not
    // present in this static markup) still carries its own tooltip on the
    // guessed item.
    const atOther = render(capability, "high")
    expect(atOther).not.toContain("doesn&#x27;t document it explicitly")
  })
})
