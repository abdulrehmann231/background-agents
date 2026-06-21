/**
 * Unit tests for sandbox resource bounds/validation.
 *
 * Pure functions — no mocks needed.
 */
import { describe, it, expect } from "vitest"
import {
  SANDBOX_RESOURCE_BOUNDS,
  clampResource,
  validateResources,
} from "./sandbox-resources"

describe("clampResource", () => {
  it("clamps below the minimum up to the minimum", () => {
    expect(clampResource("cpu", 0)).toBe(SANDBOX_RESOURCE_BOUNDS.cpu.min)
    expect(clampResource("disk", 1)).toBe(SANDBOX_RESOURCE_BOUNDS.disk.min)
  })

  it("clamps above the maximum down to the maximum", () => {
    expect(clampResource("cpu", 99)).toBe(SANDBOX_RESOURCE_BOUNDS.cpu.max)
    expect(clampResource("disk", 1000)).toBe(SANDBOX_RESOURCE_BOUNDS.disk.max)
  })

  it("rounds fractional values to integers", () => {
    expect(clampResource("memory", 3.4)).toBe(3)
    expect(clampResource("memory", 3.6)).toBe(4)
  })

  it("passes through in-range values", () => {
    expect(clampResource("cpu", 3)).toBe(3)
    expect(clampResource("disk", 12)).toBe(12)
  })
})

describe("validateResources", () => {
  it("accepts in-range values", () => {
    expect(validateResources({ cpu: 2, memory: 4, disk: 10 })).toBeNull()
  })

  it("accepts a partial request (only some fields)", () => {
    expect(validateResources({ cpu: 5 })).toBeNull()
    expect(validateResources({})).toBeNull()
  })

  it("rejects out-of-range values", () => {
    expect(validateResources({ cpu: 6 })).toMatch(/CPU/)
    expect(validateResources({ disk: 4 })).toMatch(/Disk/)
    expect(validateResources({ memory: 0 })).toMatch(/RAM/)
  })

  it("rejects non-numeric values", () => {
    // @ts-expect-error — exercising the runtime guard against bad input
    expect(validateResources({ cpu: "lots" })).toMatch(/CPU/)
  })
})
