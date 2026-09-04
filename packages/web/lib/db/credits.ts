/**
 * Credit balance reads and writes.
 *
 * `User.creditBalanceMicroUsd` is authoritative for reads — the send gate hits
 * it on every message, so it has to be O(1). `CreditTransaction` is the audit
 * trail beside it, and every movement writes both, in one transaction, or
 * neither.
 *
 * The arithmetic and the units live in lib/server/credits, which stays free of
 * database imports so it can be unit-tested.
 */

import { Prisma } from "@prisma/client"

import { prisma } from "./prisma"

/** Why a balance moved. */
export type CreditTransactionType =
  | "purchase" // Stripe payment
  | "debit" // metered usage charged to the balance
  | "refund" // Stripe refund reversed the purchase
  | "grant" // manual credit from an admin
  | "chargeback" // dispute opened against the payment
  | "adjustment" // manual correction

export interface ApplyCreditParams {
  userId: string
  /** Signed micro-dollars: positive credits the user, negative charges them. */
  amountMicroUsd: bigint
  type: CreditTransactionType
  /** Idempotency key (Stripe session / refund / dispute id). Unique. */
  externalId?: string | null
  /** The TokenUsage row a `debit` paid for. Unique. */
  tokenUsageId?: string | null
  stripeEventId?: string | null
  stripePaymentIntentId?: string | null
  chatId?: string | null
  description?: string | null
  metadata?: Prisma.InputJsonValue
}

async function applyInTransaction(
  params: ApplyCreditParams,
  tx: Prisma.TransactionClient
): Promise<bigint> {
  // Relative update, never read-then-write: two concurrent movements must both
  // land. The returned row carries the post-increment balance, so the ledger
  // row can record it without a second read.
  const user = await tx.user.update({
    where: { id: params.userId },
    data: { creditBalanceMicroUsd: { increment: params.amountMicroUsd } },
    select: { creditBalanceMicroUsd: true },
  })

  await tx.creditTransaction.create({
    data: {
      userId: params.userId,
      amountMicroUsd: params.amountMicroUsd,
      balanceAfterMicroUsd: user.creditBalanceMicroUsd,
      type: params.type,
      externalId: params.externalId ?? null,
      tokenUsageId: params.tokenUsageId ?? null,
      stripeEventId: params.stripeEventId ?? null,
      stripePaymentIntentId: params.stripePaymentIntentId ?? null,
      chatId: params.chatId ?? null,
      description: params.description ?? null,
      ...(params.metadata !== undefined ? { metadata: params.metadata } : {}),
    },
  })

  return user.creditBalanceMicroUsd
}

/**
 * Move a user's balance and record why, atomically. Returns the new balance.
 *
 * Pass `tx` when the caller already holds a transaction (the metering path
 * does, and must — its debit has to commit with the usage rows it pays for or
 * not at all). Without one, this opens its own.
 *
 * A duplicate `externalId` or `tokenUsageId` throws a unique-constraint error
 * rather than being swallowed, which rolls the balance change back with it.
 * That is deliberate: callers know what a duplicate means for them, and
 * catching it here would leave an interactive transaction aborted but looking
 * successful. Postgres refuses every later statement in a transaction where a
 * constraint has fired, so "catch and carry on" is not available at this level.
 */
export async function applyCreditTransaction(
  params: ApplyCreditParams,
  tx?: Prisma.TransactionClient
): Promise<bigint> {
  if (params.amountMicroUsd === 0n) {
    return getCreditBalance(params.userId, tx)
  }
  if (tx) return applyInTransaction(params, tx)
  return prisma.$transaction((inner) => applyInTransaction(params, inner))
}

/** Current balance in micro-dollars. Zero for an unknown user. */
export async function getCreditBalance(
  userId: string,
  tx?: Prisma.TransactionClient
): Promise<bigint> {
  const db = tx ?? prisma
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { creditBalanceMicroUsd: true },
  })
  return user?.creditBalanceMicroUsd ?? 0n
}

/** One row of a user's credit history, as the API returns it. */
export interface CreditTransactionRecord {
  id: string
  amountMicroUsd: bigint
  balanceAfterMicroUsd: bigint
  type: string
  description: string | null
  chatId: string | null
  createdAt: Date
}

/** A user's most recent balance movements, newest first. */
export async function listCreditTransactions(params: {
  userId: string
  limit?: number
}): Promise<CreditTransactionRecord[]> {
  const { userId, limit = 50 } = params
  return prisma.creditTransaction.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: Math.min(limit, 200),
    select: {
      id: true,
      amountMicroUsd: true,
      balanceAfterMicroUsd: true,
      type: true,
      description: true,
      chatId: true,
      createdAt: true,
    },
  })
}
