import { describe, expect, it } from "vitest"
import { sortByTimeKey } from "./time-series"

describe("sortByTimeKey", () => {
  it("sorts hourly keys numerically, not lexicographically", () => {
    const rows = [{ time: "10" }, { time: "2" }, { time: "0" }]
    expect(sortByTimeKey(rows, true).map((r) => r.time)).toEqual(["0", "2", "10"])
  })

  it("sorts daily keys lexicographically", () => {
    const rows = [{ time: "2026-01-10" }, { time: "2026-01-02" }, { time: "2026-01-20" }]
    expect(sortByTimeKey(rows, false).map((r) => r.time)).toEqual([
      "2026-01-02",
      "2026-01-10",
      "2026-01-20",
    ])
  })

  it("handles numeric time values for hourly sorting", () => {
    const rows = [{ time: 10 }, { time: 2 }, { time: 0 }]
    expect(sortByTimeKey(rows, true).map((r) => r.time)).toEqual([0, 2, 10])
  })
})
