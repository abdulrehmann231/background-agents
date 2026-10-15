import { randomUUID } from "crypto"
import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"

import { requireAdmin, isAuthError } from "@/lib/db/api-helpers"
import { prisma } from "@/lib/db/prisma"
import { logActivity } from "@/lib/db/activity-log"
import { applyCreditTransaction } from "@/lib/db/credits"
import { microToUsd, usdToMicro } from "@/lib/server/credits"
import {
  BONUS_CREDIT_SOURCE,
  bonusExternalId,
  bonusReasonLabel,
  parseBonusCreditRequest,
} from "@/lib/bonus-credits"

/**
 * Bonus credits for one, many, or every user — rewards for starring the repo,
 * opening a PR or filing an issue. See lib/bonus-credits.
 *
 * Each recipient gets their own ledger transaction rather than one big one: a
 * grant to every user should not roll back because one account was deleted
 * mid-run, and a duplicate (already rewarded for this star/PR) is an expected
 * per-user outcome, reported as "skipped", not a failure of the batch.
 */

/** Recipients credited concurrently. Each is a short two-statement transaction. */
const CONCURRENCY = 10

type Outcome = "granted" | "skipped" | "failed"

export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if (isAuthError(auth)) return auth
  const adminUserId = auth.userId

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const parsed = parseBonusCreditRequest(body)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const { target, amountUsd, reason, note, reference } = parsed.value

  const amountMicroUsd = usdToMicro(amountUsd)
  if (amountMicroUsd <= 0n) {
    return NextResponse.json({ error: "amountUsd is too small to record" }, { status: 400 })
  }

  // Resolve recipients against the database, so a stale id from the picker is
  // reported back instead of failing inside a transaction.
  const recipients = await prisma.user.findMany({
    where: target === "all" ? {} : { id: { in: parsed.value.userIds } },
    select: { id: true },
  })
  const recipientIds = recipients.map((u) => u.id)
  const found = new Set(recipientIds)
  const notFound =
    target === "all" ? [] : parsed.value.userIds.filter((id) => !found.has(id))

  const batchId = randomUUID()
  const description = note
    ? `Bonus: ${bonusReasonLabel(reason)} — ${note}`
    : `Bonus: ${bonusReasonLabel(reason)}`

  async function grantOne(userId: string): Promise<Outcome> {
    try {
      await applyCreditTransaction({
        userId,
        amountMicroUsd,
        type: "grant",
        externalId: bonusExternalId(userId, reason, reference),
        description,
        metadata: {
          source: BONUS_CREDIT_SOURCE,
          reason,
          note,
          reference,
          batchId,
          target,
          adminUserId,
        },
      })
      return "granted"
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        // Already rewarded for this star / PR / issue — the point of the key.
        return "skipped"
      }
      console.error(`[admin-credits] bonus grant failed for user ${userId}:`, error)
      return "failed"
    }
  }

  const outcomes: Outcome[] = []
  for (let i = 0; i < recipientIds.length; i += CONCURRENCY) {
    const chunk = recipientIds.slice(i, i + CONCURRENCY)
    outcomes.push(...(await Promise.all(chunk.map(grantOne))))
  }

  const failedUserIds = recipientIds.filter((_, i) => outcomes[i] === "failed")
  const granted = outcomes.filter((o) => o === "granted").length
  const skipped = outcomes.filter((o) => o === "skipped").length

  await logActivity(adminUserId, "credits_bonus_granted", {
    batchId,
    target,
    reason,
    note,
    reference,
    amountUsd,
    granted,
    skipped,
    failed: failedUserIds.length,
    totalUsd: granted * amountUsd,
  })

  return NextResponse.json({
    batchId,
    granted,
    skipped,
    failed: failedUserIds.length,
    failedUserIds,
    notFound,
    totalUsd: microToUsd(amountMicroUsd * BigInt(granted)),
  })
}

/** Most recent bonus grants, newest first. */
export async function GET() {
  const auth = await requireAdmin()
  if (isAuthError(auth)) return auth

  const rows = await prisma.creditTransaction.findMany({
    where: {
      type: "grant",
      metadata: { path: ["source"], equals: BONUS_CREDIT_SOURCE },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      amountMicroUsd: true,
      metadata: true,
      createdAt: true,
      user: { select: { id: true, name: true, email: true, image: true } },
    },
  })

  return NextResponse.json({
    grants: rows.map((r) => {
      const meta = (r.metadata ?? {}) as Record<string, unknown>
      const str = (v: unknown) => (typeof v === "string" ? v : null)
      return {
        id: r.id,
        amountUsd: microToUsd(r.amountMicroUsd),
        reason: str(meta.reason) ?? "other",
        note: str(meta.note),
        reference: str(meta.reference),
        target: str(meta.target),
        createdAt: r.createdAt.toISOString(),
        user: r.user,
      }
    }),
  })
}
