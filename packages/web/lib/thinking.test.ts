import { describe, expect, it } from "vitest"
import { thinkingCapability } from "./thinking"

describe("thinkingCapability", () => {
  it("maps web agent IDs to the SDK's levels", () => {
    expect(thinkingCapability("claude-code", "sonnet").levels).toContain("high")
    expect(thinkingCapability("opencode", "opencode/big-pickle").levels).toEqual([])
  })
})
