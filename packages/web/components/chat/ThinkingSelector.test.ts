import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import type { ThinkingCapability } from "@background-agents/sdk/thinking"
import { ThinkingSelector } from "./ThinkingSelector"

function render(capability: ThinkingCapability, value = "default") {
  return renderToStaticMarkup(createElement(ThinkingSelector, { capability, value, onChange: vi.fn() }))
}

describe("ThinkingSelector", () => {
  it("is hidden for models without adjustable levels", () => {
    expect(render({ levels: [] })).toBe("")
  })

  it("shows the selected level with the Default explanation", () => {
    const html = render({ levels: ["low", "high"], control: "claude-effort" }, "high")
    expect(html).toContain('aria-label="Thinking level"')
    expect(html).toContain("Default uses the agent and model&#x27;s own thinking setting")
  })
})
