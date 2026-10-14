import { Prisma } from "@prisma/client"

import { BONUS_CREDIT_SOURCE, GITHUB_STAR_CREDIT_USD, bonusExternalId } from "@/lib/bonus-credits"
import { isGitHubAuthError, requireGitHubAuth } from "@/lib/db/api-helpers"
import { applyCreditTransaction } from "@/lib/db/credits"
import { prisma } from "@/lib/db/prisma"
import { usdToMicro } from "@/lib/server/credits"

const STAR_URL = "https://api.github.com/user/starred/jamesmurdza/background-agents"

async function alreadyRewarded(userId: string): Promise<boolean> {
  const existing = await prisma.creditTransaction.findUnique({
    where: { externalId: bonusExternalId(userId, "github_star", null)! },
    select: { id: true },
  })
  return existing !== null
}

function githubHeaders(token: string): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  }
}

export async function GET() {
  const auth = await requireGitHubAuth()
  if (isGitHubAuthError(auth)) return auth

  const rewarded = await alreadyRewarded(auth.userId)
  if (rewarded) return Response.json({ rewarded, starred: true, amountUsd: GITHUB_STAR_CREDIT_USD })

  try {
    const response = await fetch(STAR_URL, { headers: githubHeaders(auth.token), cache: "no-store" })
    if (response.status !== 204 && response.status !== 404) {
      console.error(`[star-reward] GitHub star check failed: HTTP ${response.status}`)
      return Response.json({ error: "Could not check your GitHub star" }, { status: 502 })
    }
    return Response.json({ rewarded: false, starred: response.status === 204, amountUsd: GITHUB_STAR_CREDIT_USD })
  } catch (error) {
    console.error("[star-reward] GitHub star check failed:", error)
    return Response.json({ error: "Could not check your GitHub star" }, { status: 502 })
  }
}

export async function POST() {
  const auth = await requireGitHubAuth()
  if (isGitHubAuthError(auth)) return auth

  if (await alreadyRewarded(auth.userId)) {
    return Response.json({ rewarded: true, granted: false, amountUsd: GITHUB_STAR_CREDIT_USD })
  }

  try {
    const response = await fetch(STAR_URL, {
      method: "PUT",
      headers: { ...githubHeaders(auth.token), "Content-Length": "0" },
      cache: "no-store",
    })
    if (response.status !== 204) {
      console.error(`[star-reward] GitHub star failed: HTTP ${response.status}`)
      return Response.json({ error: "Could not star the repository on GitHub" }, { status: 502 })
    }
  } catch (error) {
    console.error("[star-reward] GitHub star failed:", error)
    return Response.json({ error: "Could not star the repository on GitHub" }, { status: 502 })
  }

  try {
    await applyCreditTransaction({
      userId: auth.userId,
      amountMicroUsd: usdToMicro(GITHUB_STAR_CREDIT_USD),
      type: "grant",
      externalId: bonusExternalId(auth.userId, "github_star", null),
      description: "Bonus: Starred the repo",
      metadata: { source: BONUS_CREDIT_SOURCE, reason: "github_star", target: "self" },
    })
    return Response.json({ rewarded: true, granted: true, amountUsd: GITHUB_STAR_CREDIT_USD })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      // Another claim or admin grant won the unique ledger key.
      return Response.json({ rewarded: true, granted: false, amountUsd: GITHUB_STAR_CREDIT_USD })
    }
    console.error(`[star-reward] Credit grant failed for user ${auth.userId}:`, error)
    return Response.json({ error: "Repository starred, but credits could not be added. Please retry." }, { status: 500 })
  }
}
