import { describe, expect, it } from "vitest"

import { bonusExternalId, parseBonusCreditRequest } from "./bonus-credits"

describe("parseBonusCreditRequest", () => {
  const base = { target: "users", userIds: ["u1"], amountUsd: 5, reason: "github_star" }

  it("accepts a valid request and dedupes user ids", () => {
    const r = parseBonusCreditRequest({ ...base, userIds: ["u1", "u1", "u2"], note: "  hi " })
    expect(r).toEqual({
      ok: true,
      value: {
        target: "users",
        userIds: ["u1", "u2"],
        amountUsd: 5,
        reason: "github_star",
        note: "hi",
        reference: null,
      },
    })
  })

  it("ignores userIds for all users", () => {
    const r = parseBonusCreditRequest({ ...base, target: "all", userIds: undefined })
    expect(r.ok && r.value.userIds).toEqual([])
  })

  it.each([
    [{ ...base, target: "some" }, "target"],
    [{ ...base, userIds: [] }, "at least one"],
    [{ ...base, userIds: [1] }, "userIds"],
    [{ ...base, amountUsd: 0 }, "positive"],
    [{ ...base, amountUsd: -3 }, "positive"],
    [{ ...base, amountUsd: 5000 }, "at most"],
    [{ ...base, reason: "nope" }, "reason"],
    [{ ...base, reason: "other", note: "   " }, "note"],
  ])("rejects %j", (body, fragment) => {
    const r = parseBonusCreditRequest(body)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.toLowerCase()).toContain(fragment.toLowerCase())
  })
})

describe("bonusExternalId", () => {
  it("always dedupes stars, per user", () => {
    expect(bonusExternalId("u1", "github_star", null)).toBe("bonus:github_star:u1")
    expect(bonusExternalId("u1", "github_star", "x")).toBe("bonus:github_star:u1")
  })

  it("dedupes PRs and issues only with a reference", () => {
    expect(bonusExternalId("u1", "pull_request", null)).toBeNull()
    expect(bonusExternalId("u1", "pull_request", "Org/Repo#12")).toBe(
      "bonus:pull_request:org/repo#12:u1"
    )
    expect(bonusExternalId("u1", "issue", null)).toBeNull()
  })
})
