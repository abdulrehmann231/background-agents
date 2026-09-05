import { Prisma } from "@prisma/client"

import { prisma } from "@/lib/db/prisma"
import {
  DAILY_CREDIT_CAP,
  DAILY_CREDIT_USD,
  usdToMicro,
} from "@/lib/server/credits"

/**
 * Daily credit top-up.
 *
 * Adds {@link DAILY_CREDIT_USD} to every balance below {@link DAILY_CREDIT_CAP},
 * once per UTC day. Negative balances are included on purpose — see the constant
 * — so an account that overshot digs itself out rather than being bricked.
 *
 * One statement, not a loop over users. Production caps the Prisma pool at one
 * connection per instance, so several hundred sequential transactions would
 * monopolise it for the duration; and the whole point of the operation is that
 * it either applies to a user today or does not, which a single data-modifying
 * CTE expresses directly. Same shape as migration
 * 20260905120000_backfill_signup_credits, for the same reasons.
 *
 * Exactly-once per user per UTC day rests on `CreditTransaction.externalId`
 * being uniquely indexed: the `NOT EXISTS` skips anyone already topped up, and
 * if two runs race past it the index aborts the statement — which rolls the
 * balance update back with it, because both halves are one statement. A retry,
 * a double fire, or a manual curl during the scheduled run are all safe.
 *
 * No catch-up for a missed day. With a cap this low, replaying yesterday buys
 * the user a few cents and costs us a backfill loop to reason about.
 */
export const maxDuration = 60

/** Micro-dollars added per user per day. */
const AMOUNT_MICRO = usdToMicro(DAILY_CREDIT_USD)
/** Top up only a balance strictly below this, in micro-dollars. */
const CAP_MICRO = usdToMicro(DAILY_CREDIT_CAP)

export async function GET(req: Request) {
  // Verify cron secret (skip auth if not configured, for local development)
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401 })
  }

  // The UTC day is the idempotency key, so it is computed here and passed in
  // rather than read from the database clock: two instances that disagree about
  // "today" would each get their own grant through the NOT EXISTS.
  const day = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
  const idPrefix = `daily_${day.replace(/-/g, "")}_`
  const keyPrefix = `daily:`
  const metadata = { day, cap: DAILY_CREDIT_CAP }

  try {
    // Every interpolation is cast explicitly. Prisma sends these as untyped
    // bind parameters, and Postgres cannot infer a type for one that appears
    // only inside a `||` concatenation — it fails the whole statement with
    // "could not determine data type of parameter" rather than guessing.
    const granted = await prisma.$executeRaw`
      WITH topped AS (
        UPDATE "User" u
           SET "creditBalanceMicroUsd" =
                 u."creditBalanceMicroUsd" + ${AMOUNT_MICRO}::bigint
         WHERE u."creditBalanceMicroUsd" < ${CAP_MICRO}::bigint
           AND NOT EXISTS (
             SELECT 1 FROM "CreditTransaction" t
              WHERE t."externalId" = ${keyPrefix}::text || u."id" || ':' || ${day}::text
           )
        RETURNING u."id", u."creditBalanceMicroUsd"
      )
      INSERT INTO "CreditTransaction" (
        "id", "userId", "amountMicroUsd", "balanceAfterMicroUsd",
        "type", "externalId", "description", "metadata", "createdAt"
      )
      SELECT
        -- Derived from user + day rather than random, so the primary key is a
        -- second idempotency guard behind the unique "externalId" index.
        ${idPrefix}::text || t."id",
        t."id",
        ${AMOUNT_MICRO}::bigint,
        t."creditBalanceMicroUsd",
        'daily',
        ${keyPrefix}::text || t."id" || ':' || ${day}::text,
        'Daily credit',
        ${JSON.stringify(metadata)}::jsonb,
        CURRENT_TIMESTAMP
      FROM topped t
    `

    console.log(
      `[daily-credits] granted $${DAILY_CREDIT_USD.toFixed(2)} to ${granted} ` +
        `user${granted === 1 ? "" : "s"} for ${day}`
    )
    return Response.json({ day, granted, amountUsd: DAILY_CREDIT_USD })
  } catch (error) {
    // A unique-constraint violation here means a concurrent run won the race and
    // already granted today — the statement rolled back whole, so nothing is
    // half-applied and there is nothing to repair.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      console.warn(`[daily-credits] concurrent run already granted for ${day}`)
      return Response.json({ day, granted: 0, amountUsd: DAILY_CREDIT_USD })
    }
    console.error("[daily-credits] failed:", error)
    return new Response("Daily credit grant failed", { status: 500 })
  }
}
