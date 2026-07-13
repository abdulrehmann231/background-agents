/**
 * Unit tests for the shared OpenCode key pool.
 */
import { describe, it, expect, afterEach, vi } from "vitest"
import {
  getSharedOpencodeKeys,
  hasSharedOpencodeKey,
  pickSharedOpencodeKey,
} from "./opencode-pool"

const KEY = "OPENCODE_API_KEY"

afterEach(() => {
  delete process.env[KEY]
  vi.restoreAllMocks()
})

describe("getSharedOpencodeKeys", () => {
  it("returns [] when the key is not configured", () => {
    expect(getSharedOpencodeKeys()).toEqual([])
    expect(hasSharedOpencodeKey()).toBe(false)
  })

  it("returns a single key when one is set", () => {
    process.env[KEY] = "primary"
    expect(getSharedOpencodeKeys()).toEqual(["primary"])
    expect(hasSharedOpencodeKey()).toBe(true)
  })

  it("splits comma-separated keys, trimming whitespace", () => {
    process.env[KEY] = " primary , secondary , third "
    expect(getSharedOpencodeKeys()).toEqual(["primary", "secondary", "third"])
  })

  it("drops blank entries between commas", () => {
    process.env[KEY] = "primary,,   ,secondary"
    expect(getSharedOpencodeKeys()).toEqual(["primary", "secondary"])
  })

  it("returns [] for an all-blank value", () => {
    process.env[KEY] = "  , ,  "
    expect(getSharedOpencodeKeys()).toEqual([])
    expect(hasSharedOpencodeKey()).toBe(false)
  })
})

describe("pickSharedOpencodeKey", () => {
  it("returns undefined when nothing is configured", () => {
    expect(pickSharedOpencodeKey()).toBeUndefined()
  })

  it("returns the single key when only one is configured", () => {
    process.env[KEY] = "primary"
    expect(pickSharedOpencodeKey()).toBe("primary")
  })

  it("selects by Math.random across all keys", () => {
    process.env[KEY] = "a,b,c"
    // Math.random in [0, 1/3) → index 0, [1/3, 2/3) → index 1, [2/3, 1) → index 2.
    vi.spyOn(Math, "random").mockReturnValue(0)
    expect(pickSharedOpencodeKey()).toBe("a")
    vi.spyOn(Math, "random").mockReturnValue(0.5)
    expect(pickSharedOpencodeKey()).toBe("b")
    vi.spyOn(Math, "random").mockReturnValue(0.9)
    expect(pickSharedOpencodeKey()).toBe("c")
  })

  it("spreads roughly evenly across all keys over many draws", () => {
    process.env[KEY] = "a,b,c"
    const counts: Record<string, number> = { a: 0, b: 0, c: 0 }
    for (let i = 0; i < 6000; i++) counts[pickSharedOpencodeKey()!]++
    // Each should land well within a generous band around 1/3 (2000).
    expect(counts.a).toBeGreaterThan(1600)
    expect(counts.b).toBeGreaterThan(1600)
    expect(counts.c).toBeGreaterThan(1600)
  })
})
