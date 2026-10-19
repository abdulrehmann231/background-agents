import { describe, expect, it } from "vitest"
import { reasoningEffortCapability } from "./reasoning-effort"

describe("reasoningEffortCapability", () => {
  it("maps web agent IDs to the SDK's levels", () => {
    expect(reasoningEffortCapability("claude-code", "sonnet").levels).toContain("high")
    expect(reasoningEffortCapability("opencode", "opencode/big-pickle").levels).toEqual([])
  })
})
