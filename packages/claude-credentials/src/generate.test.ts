/**
 * Tests for the snapshot-lifecycle helpers that keep credential refresh working
 * after Daytona garbage-collects (prunes) the backing image of a previously
 * built snapshot.
 *
 * The bug these guard against: passing an inline `Image` to `daytona.create()`
 * registers an anonymous, prunable snapshot. Once pruned, later runs fail with
 * "pull access denied ... repository does not exist" and never self-heal. We
 * switched to a *named* snapshot that ensureCCAuthSnapshot can look up and
 * deterministically rebuild.
 */
import { describe, it, expect } from "vitest"
import type { Image } from "@daytonaio/sdk"
import { ensureCCAuthSnapshot, getCCAuthSnapshotName } from "./generate"

type FakeState =
  | "active"
  | "building"
  | "pending"
  | "pulling"
  | "error"
  | "build_failed"
  | "removing"

/**
 * Minimal stand-in for the pieces of the Daytona SDK that ensureCCAuthSnapshot
 * touches: `snapshot.get` / `snapshot.delete` / `snapshot.create`. It records
 * every call so tests can assert on the sequence of decisions.
 */
function makeFakeDaytona(opts: {
  /** Initial snapshot state, or undefined to simulate "not found". */
  initial?: FakeState
  /** State to report after a (re)build completes. Defaults to "active". */
  afterCreate?: FakeState
}) {
  const calls: string[] = []
  let state: FakeState | undefined = opts.initial

  const snapshot = {
    async get(name: string) {
      calls.push(`get:${state ?? "missing"}`)
      if (state === undefined) {
        throw new Error(`Snapshot ${name} not found (404)`)
      }
      return { id: `id-${name}`, name, state }
    },
    async delete(_snap: { id: string }) {
      calls.push(`delete`)
      state = undefined
    },
    async create({ name }: { name: string }) {
      calls.push(`create`)
      state = opts.afterCreate ?? "active"
      return { id: `id-${name}`, name, state }
    },
  }

  return { daytona: { snapshot }, calls, getState: () => state }
}

const fakeImage = {} as Image

describe("getCCAuthSnapshotName", () => {
  it("derives a stable name from the first 12 chars of the ccauth SHA", () => {
    const sha = "abcdef0123456789deadbeef"
    expect(getCCAuthSnapshotName(sha)).toBe("ccauth-abcdef012345")
  })
})

describe("ensureCCAuthSnapshot", () => {
  it("reuses an already-active snapshot without rebuilding", async () => {
    const { daytona, calls } = makeFakeDaytona({ initial: "active" })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await ensureCCAuthSnapshot(daytona as any, "ccauth-x", fakeImage)
    expect(calls).toEqual(["get:active"])
  })

  it("builds the snapshot when it is missing", async () => {
    const { daytona, calls, getState } = makeFakeDaytona({ initial: undefined })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await ensureCCAuthSnapshot(daytona as any, "ccauth-x", fakeImage)
    expect(calls).toEqual(["get:missing", "create"])
    expect(getState()).toBe("active")
  })

  it("deletes and rebuilds a pruned/failed snapshot (the reported bug)", async () => {
    // A snapshot whose backing image was pruned surfaces here as a non-active
    // terminal state; we must delete the dangling record and rebuild.
    const { daytona, calls, getState } = makeFakeDaytona({ initial: "error" })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await ensureCCAuthSnapshot(daytona as any, "ccauth-x", fakeImage)
    expect(calls).toEqual(["get:error", "delete", "create"])
    expect(getState()).toBe("active")
  })

  it("force-rebuilds even an active snapshot when rebuild is requested", async () => {
    // This is the recovery path taken after sandbox creation reports a pruned
    // image despite the snapshot metadata looking healthy.
    const { daytona, calls } = makeFakeDaytona({ initial: "active" })
    await ensureCCAuthSnapshot(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      daytona as any,
      "ccauth-x",
      fakeImage,
      { rebuild: true },
    )
    expect(calls).toEqual(["get:active", "delete", "create"])
  })
})
