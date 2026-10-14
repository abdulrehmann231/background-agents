import { describe, it, expect } from "vitest"
import { getClientIpFromHeaders } from "./request-ip"

describe("getClientIpFromHeaders", () => {
  it("returns the first address in x-forwarded-for", () => {
    const headers = new Headers({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" })
    expect(getClientIpFromHeaders(headers)).toBe("1.2.3.4")
  })

  it("trims whitespace around the first address", () => {
    const headers = new Headers({ "x-forwarded-for": " 1.2.3.4 , 5.6.7.8" })
    expect(getClientIpFromHeaders(headers)).toBe("1.2.3.4")
  })

  it("falls back to x-real-ip when x-forwarded-for is absent", () => {
    const headers = new Headers({ "x-real-ip": "9.9.9.9" })
    expect(getClientIpFromHeaders(headers)).toBe("9.9.9.9")
  })

  it("returns undefined when neither header is present", () => {
    const headers = new Headers()
    expect(getClientIpFromHeaders(headers)).toBeUndefined()
  })
})
