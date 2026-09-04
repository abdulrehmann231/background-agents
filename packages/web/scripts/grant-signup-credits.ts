/**
 * One-off backfill: give existing accounts the signup credit.
 *
 * `events.createUser` grants SIGNUP_CREDIT_USD to every account created from
 * the deploy onwards, but it cannot reach the accounts that already existed —
 * and with gating purely on purchased credits (see lib/db/usage-limit), those
 * users land on a zero balance and cannot run a shared-pool turn at all. This
 * closes that gap once.
 *
 * Read-only by default: prints who would be granted and what it would cost.
 *
 *   npm run grant:signup-credits             # dry run
 *   npm run grant:signup-credits -- --apply  # write the grants
 *   npm run grant:signup-credits -- --apply --include-funded
 *
 * Safe to re-run, and safe to run while signups are happening. Each grant is
 * keyed on `externalId = signup:<userId>` under a unique index, so a user the
 * auth callback has already credited is skipped by the database rather than by
 * this script's own read — the two cannot race into a double grant.
 *
 * `--apply` alone skips anyone whose balance or ledger shows they have already
 * been funded (a purchase, an admin grant, or a signup grant), which is the
 * conservative set: it tops up nobody who is already able to send.
 * `--include-funded` grants to every user without a signup grant regardless of
 * their current balance — use it only if you mean to hand existing paying users
 * the starting credit too.
 */

import path from "node:path"

import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { config as loadEnv } from "dotenv"
import pg from "pg"

import {
  SIGNUP_CREDIT_USD,
  microToUsd,
  signupGrantKey,
  usdToMicro,
} from "../lib/server/credits"

// Same precedence as prisma.config.ts and Next itself: .env.local wins. Without
// this the script reads whatever happens to be exported in the shell, which is
// how a backfill ends up pointed at the wrong database.
const packageDir = path.join(__dirname, "..")
loadEnv({ path: path.join(packageDir, ".env") })
loadEnv({ path: path.join(packageDir, ".env.local"), override: true })

const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL
if (!connectionString) throw new Error("DATABASE_URL is not set")

// Say out loud which database is about to be read (and possibly written).
console.log(`Database: ${connectionString.replace(/:\/\/[^@]*@/, "://***@")}`)

const prisma = new PrismaClient({
  adapter: new PrismaPg(new pg.Pool({ connectionString, max: 5 })),
})

const APPLY = process.argv.includes("--apply")
const INCLUDE_FUNDED = process.argv.includes("--include-funded")

const AMOUNT_MICRO = usdToMicro(SIGNUP_CREDIT_USD)

async function main() {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      creditBalanceMicroUsd: true,
      creditTransactions: {
        select: { type: true, externalId: true },
      },
    },
    orderBy: { createdAt: "asc" },
  })

  console.log(`\nAccounts: ${users.length}`)
  console.log(`Signup credit: $${SIGNUP_CREDIT_USD.toFixed(2)} (${AMOUNT_MICRO} micro-USD)`)

  const alreadyGranted: typeof users = []
  const alreadyFunded: typeof users = []
  const targets: typeof users = []

  for (const user of users) {
    const hasSignupGrant = user.creditTransactions.some(
      (t) => t.externalId === signupGrantKey(user.id)
    )
    if (hasSignupGrant) {
      alreadyGranted.push(user)
      continue
    }
    // "Funded" means this account has seen real money or a deliberate grant, so
    // a starting credit is not what it is missing.
    const funded =
      user.creditBalanceMicroUsd !== 0n ||
      user.creditTransactions.some(
        (t) => t.type === "purchase" || t.type === "grant" || t.type === "adjustment"
      )
    if (funded && !INCLUDE_FUNDED) {
      alreadyFunded.push(user)
      continue
    }
    targets.push(user)
  }

  console.log(`  already have a signup grant: ${alreadyGranted.length}`)
  console.log(
    `  otherwise funded (skipped${INCLUDE_FUNDED ? " — overridden" : ""}): ${alreadyFunded.length}`
  )
  console.log(`  to grant: ${targets.length}`)
  console.log(`  total cost: $${(targets.length * SIGNUP_CREDIT_USD).toFixed(2)}\n`)

  if (targets.length === 0) return

  for (const user of targets.slice(0, 20)) {
    console.log(
      `  ${user.id}  ${user.email ?? "(no email)"}  ` +
        `balance $${microToUsd(user.creditBalanceMicroUsd).toFixed(2)}`
    )
  }
  if (targets.length > 20) console.log(`  … and ${targets.length - 20} more`)

  if (!APPLY) {
    console.log(`\nDry run. Re-run with --apply to write these grants.`)
    return
  }

  let granted = 0
  let skipped = 0
  for (const user of targets) {
    try {
      // Same two writes the app does, in one transaction: the balance and the
      // ledger row that explains it, or neither.
      await prisma.$transaction(async (tx) => {
        const updated = await tx.user.update({
          where: { id: user.id },
          data: { creditBalanceMicroUsd: { increment: AMOUNT_MICRO } },
          select: { creditBalanceMicroUsd: true },
        })
        await tx.creditTransaction.create({
          data: {
            userId: user.id,
            amountMicroUsd: AMOUNT_MICRO,
            balanceAfterMicroUsd: updated.creditBalanceMicroUsd,
            type: "grant",
            externalId: signupGrantKey(user.id),
            description: "Signup credit",
          },
        })
      })
      granted += 1
    } catch (error) {
      // The unique index on externalId firing means the auth callback got there
      // first, mid-run. That is the mechanism working, not a failure.
      const code = (error as { code?: string }).code
      if (code === "P2002") {
        skipped += 1
        continue
      }
      console.error(`  failed for ${user.id}:`, error)
    }
  }

  console.log(`\nGranted: ${granted}`)
  if (skipped > 0) console.log(`Skipped (granted concurrently): ${skipped}`)
  console.log(`Spent: $${(granted * SIGNUP_CREDIT_USD).toFixed(2)}`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
