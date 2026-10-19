import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { EffortSelector } from "./EffortSelector"

describe("EffortSelector", () => {
  it("is a self-contained, always-visible control with a clearly cosmetic explanation", () => {
    const html = renderToStaticMarkup(createElement(EffortSelector, {}))
    expect(html).toContain('aria-label="Effort level"')
    expect(html).toContain("Cosmetic only")
  })
})
