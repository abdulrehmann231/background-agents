import { beforeEach, describe, expect, it, vi } from "vitest"

const { requireGitHubAuth, findUnique, applyCreditTransaction } = vi.hoisted(() => ({
  requireGitHubAuth: vi.fn(),
  findUnique: vi.fn(),
  applyCreditTransaction: vi.fn(),
}))

vi.mock("@/lib/db/api-helpers", () => ({
  requireGitHubAuth,
  isGitHubAuthError: (value: unknown) => value instanceof Response,
}))
vi.mock("@/lib/db/prisma", () => ({ prisma: { creditTransaction: { findUnique } } }))
vi.mock("@/lib/db/credits", () => ({ applyCreditTransaction }))

import { GET, POST } from "./route"

describe("star reward", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    requireGitHubAuth.mockResolvedValue({ userId: "user-1", token: "test-token" })
    findUnique.mockResolvedValue(null)
    applyCreditTransaction.mockResolvedValue(250000n)
  })

  it("checks whether the signed-in user already starred the repository", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }))
    try {
      const response = await GET()
      expect(await response.json()).toEqual({ rewarded: false, starred: true, amountUsd: 0.25 })
      expect(fetchMock).toHaveBeenCalledWith(
        "https://api.github.com/user/starred/jamesmurdza/background-agents",
        expect.objectContaining({ cache: "no-store" })
      )
    } finally {
      fetchMock.mockRestore()
    }
  })

  it("stars and grants once, using the same key as admin star rewards", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }))
    try {
      const response = await POST()
      expect(await response.json()).toEqual({ rewarded: true, granted: true, amountUsd: 0.25 })
      expect(fetchMock).toHaveBeenCalledWith(
        "https://api.github.com/user/starred/jamesmurdza/background-agents",
        expect.objectContaining({ method: "PUT" })
      )
      expect(applyCreditTransaction).toHaveBeenCalledWith(expect.objectContaining({
        userId: "user-1",
        amountMicroUsd: 250000n,
        externalId: "bonus:github_star:user-1",
      }))
      findUnique.mockResolvedValue({ id: "grant-1" })
      const repeat = await POST()
      expect(await repeat.json()).toEqual({ rewarded: true, granted: false, amountUsd: 0.25 })
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(applyCreditTransaction).toHaveBeenCalledTimes(1)
    } finally {
      fetchMock.mockRestore()
    }
  })

  it("never grants credits when GitHub rejects the star", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 403 }))
    try {
      expect((await POST()).status).toBe(502)
      expect(applyCreditTransaction).not.toHaveBeenCalled()
    } finally {
      fetchMock.mockRestore()
    }
  })
})
