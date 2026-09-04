import { NextRequest, NextResponse } from "next/server"

import { requireAdmin, isAuthError } from "@/lib/db/api-helpers"
import { prisma } from "@/lib/db/prisma"
import { logActivity } from "@/lib/db/activity-log"
import { applyCreditTransaction, listCreditTransactions } from "@/lib/db/credits"
import { microToUsd, usdToMicro } from "@/lib/server/credits"

/**
 * Manual credit movements, for admins.
 *
 * This is what makes the credit system operable and testable without Stripe:
 * grant yourself a balance, watch usage draw it down, and correct anything a
 * payment got wrong. It is also the tool for the case Stripe cannot handle
 * itself — a payment that arrived with no resolvable user, which the webhook
 * deliberately refuses to guess at.
 */

/**
 * Ceiling on a single manual movement, in USD.
 *
 * Not a policy limit — an admin can simply post twice — but a guard against a
 * mistyped amount. A credit is real money the platform then spends on the
 * user's behalf, and there is no undo beyond posting the negative.
 */
const MAX_ADJUSTMENT_USD = 10_000

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const auth = await requireAdmin()
  if (isAuthError(auth)) return auth

  const { userId: targetUserId } = await params

  let body: { amountUsd?: unknown; note?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const amountUsd = body.amountUsd
  if (typeof amountUsd !== "number" || !Number.isFinite(amountUsd) || amountUsd === 0) {
    return NextResponse.json(
      { error: "amountUsd must be a non-zero finite number" },
      { status: 400 }
    )
  }
  if (Math.abs(amountUsd) > MAX_ADJUSTMENT_USD) {
    return NextResponse.json(
      { error: `amountUsd must be within +/-${MAX_ADJUSTMENT_USD}` },
      { status: 400 }
    )
  }

  const amountMicroUsd = usdToMicro(amountUsd)
  if (amountMicroUsd === 0n) {
    // Below a micro-dollar. Rejected rather than silently written as a no-op
    // row, so the caller learns nothing happened.
    return NextResponse.json(
      { error: "amountUsd is too small to record" },
      { status: 400 }
    )
  }

  const targetUser = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, name: true, email: true },
  })
  if (!targetUser) {
    return NextResponse.json({ error: "User not found" }, { status: 404 })
  }

  const note = typeof body.note === "string" ? body.note.slice(0, 500) : null

  // A positive movement is a gift of credits; a negative one is a correction.
  // They are separate types so the ledger (and the reconciliation cron) can
  // tell "we gave this away" from "we took it back".
  const type = amountUsd > 0 ? "grant" : "adjustment"

  const balance = await applyCreditTransaction({
    userId: targetUserId,
    amountMicroUsd,
    type,
    description: note ?? `Manual ${type} by admin`,
    metadata: { adminUserId: auth.userId },
  })

  await logActivity(auth.userId, "credits_adjusted", {
    targetUserId,
    targetUserName: targetUser.name,
    amountUsd,
    type,
    note,
    balanceAfterUsd: microToUsd(balance),
  })

  return NextResponse.json({
    userId: targetUserId,
    amountUsd,
    type,
    balanceUsd: microToUsd(balance),
  })
}

/** The target user's balance and recent movements. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const auth = await requireAdmin()
  if (isAuthError(auth)) return auth

  const { userId: targetUserId } = await params

  const user = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { creditBalanceMicroUsd: true },
  })
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 })
  }

  const transactions = await listCreditTransactions({ userId: targetUserId })

  return NextResponse.json({
    balanceUsd: microToUsd(user.creditBalanceMicroUsd),
    transactions: transactions.map((t) => ({
      id: t.id,
      amountUsd: microToUsd(t.amountMicroUsd),
      balanceAfterUsd: microToUsd(t.balanceAfterMicroUsd),
      type: t.type,
      description: t.description,
      chatId: t.chatId,
      createdAt: t.createdAt.toISOString(),
    })),
  })
}
