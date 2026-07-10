/**
 * Unit tests for the shared OpenCode key pool.
 */
import { describe, it, expect, afterEach, vi } from "vitest"
import {
  getSharedOpencodeKeys,
  hasSharedOpencodeKey,
  pickSharedOpencodeKey,
} from "./opencode-pool"

const PRIMARY = "OPENCODE_API_KEY"
const SECONDARY = "OPENCODE_API_KEY_SECONDARY"

afterEach(() => {
  delete process.env[PRIMARY]
  delete process.env[SECONDARY]
  vi.restoreAllMocks()
})

describe("getSharedOpencodeKeys", () => {
  it("returns [] when neither key is configured", () => {
    expect(getSharedOpencodeKeys()).toEqual([])
    expect(hasSharedOpencodeKey()).toBe(false)
  })

  it("returns just the primary when only it is set", () => {
    process.env[PRIMARY] = "primary"
    expect(getSharedOpencodeKeys()).toEqual(["primary"])
    expect(hasSharedOpencodeKey()).toBe(true)
  })

  it("returns just the secondary when only it is set", () => {
    process.env[SECONDARY] = "secondary"
    expect(getSharedOpencodeKeys()).toEqual(["secondary"])
  })

  it("returns both (primary first) when both are set, trimming whitespace", () => {
    process.env[PRIMARY] = " primary "
    process.env[SECONDARY] = " secondary "
    expect(getSharedOpencodeKeys()).toEqual(["primary", "secondary"])
  })

  it("drops a blank secondary", () => {
    process.env[PRIMARY] = "primary"
    process.env[SECONDARY] = "   "
    expect(getSharedOpencodeKeys()).toEqual(["primary"])
  })
})

describe("pickSharedOpencodeKey", () => {
  it("returns undefined when nothing is configured", () => {
    expect(pickSharedOpencodeKey()).toBeUndefined()
  })

  it("returns the single key when only one is configured", () => {
    process.env[PRIMARY] = "primary"
    expect(pickSharedOpencodeKey()).toBe("primary")
  })

  it("selects by Math.random across both keys", () => {
    process.env[PRIMARY] = "primary"
    process.env[SECONDARY] = "secondary"
    // Math.random in [0, 0.5) → index 0 (primary), [0.5, 1) → index 1 (secondary).
    vi.spyOn(Math, "random").mockReturnValue(0)
    expect(pickSharedOpencodeKey()).toBe("primary")
    vi.spyOn(Math, "random").mockReturnValue(0.75)
    expect(pickSharedOpencodeKey()).toBe("secondary")
  })

  it("spreads roughly 50/50 across both keys over many draws", () => {
    process.env[PRIMARY] = "primary"
    process.env[SECONDARY] = "secondary"
    const counts: Record<string, number> = { primary: 0, secondary: 0 }
    for (let i = 0; i < 4000; i++) counts[pickSharedOpencodeKey()!]++
    // Each should land well within a generous band around 50%.
    expect(counts.primary).toBeGreaterThan(1600)
    expect(counts.secondary).toBeGreaterThan(1600)
  })
})
