/**
 * One-off backfill: re-price historical Claude rows in the TokenUsage ledger.
 *
 * Rows written before the pool moved to a cost budget carry whatever cost
 * tokscale reported, which it resolved from LiteLLM's price table over the
 * network. A model id it failed to resolve was recorded at $0 — an unmetered
 * turn that a dollar budget can't see. This recomputes `costUsd` from
 * Anthropic's published rates (lib/server/claude-pricing) using the token
 * components each row already stores.
 *
 * Read-only by default: prints a survey and the repricing it would do.
 *
 *   npm run backfill:claude-cost             # survey + dry run
 *   npm run backfill:claude-cost -- --apply  # write the zero-cost rows
 *   npm run backfill:claude-cost -- --apply --include-nonzero
 *
 * `--apply` alone touches only rows currently at $0 with real tokens, which is
 * the safe, obviously-wrong set. `--include-nonzero` additionally corrects rows
 * whose stored cost disagrees with our own by more than a cent — review the dry
 * run before reaching for it.
 */

import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import pg from "pg"

import { priceClaudeTurn } from "../lib/server/claude-pricing"

const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL
if (!connectionString) throw new Error("DATABASE_URL is not set")

// Say out loud which database is about to be read (and possibly written).
console.log(`Database: ${connectionString.replace(/:\/\/[^@]*@/, "://***@")}`)

const prisma = new PrismaClient({
  adapter: new PrismaPg(new pg.Pool({ connectionString, max: 5 })),
})

const APPLY = process.argv.includes("--apply")
const INCLUDE_NONZERO = process.argv.includes("--include-nonzero")

/** Ignore sub-cent disagreement when deciding a non-zero row is "wrong". */
const NONZERO_TOLERANCE_USD = 0.01

const usd = (n: number) => `$${n.toFixed(4)}`

async function main() {
  const rows = await prisma.tokenUsage.findMany({
    where: { provider: "claude" },
    select: {
      id: true,
      model: true,
      pool: true,
      costUsd: true,
      inputTokens: true,
      outputTokens: true,
      cacheReadTokens: true,
      cacheWriteTokens: true,
      reasoningTokens: true,
      totalTokens: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  })

  console.log(`\nClaude rows in the ledger: ${rows.length}`)
  if (rows.length === 0) return

  // ── Survey, per model ─────────────────────────────────────────────────────
  interface Bucket {
    rows: number
    tokens: number
    storedCost: number
    ourCost: number
    zeroCostRows: number
    zeroCostTokens: number
    unpriced: number
  }
  const byModel = new Map<string, Bucket>()

  const toReprice: { id: string; from: number; to: number; zero: boolean }[] = []

  for (const r of rows) {
    const key = r.model ?? "(null)"
    const b = byModel.get(key) ?? {
      rows: 0,
      tokens: 0,
      storedCost: 0,
      ourCost: 0,
      zeroCostRows: 0,
      zeroCostTokens: 0,
      unpriced: 0,
    }

    const ours = priceClaudeTurn(r.model, {
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      cacheReadTokens: r.cacheReadTokens,
      cacheWriteTokens: r.cacheWriteTokens,
      reasoningTokens: r.reasoningTokens,
    })

    b.rows += 1
    b.tokens += r.totalTokens
    b.storedCost += r.costUsd
    if (ours === null) b.unpriced += 1
    else b.ourCost += ours

    const isZero = r.costUsd === 0 && r.totalTokens > 0
    if (isZero) {
      b.zeroCostRows += 1
      b.zeroCostTokens += r.totalTokens
    }

    byModel.set(key, b)

    if (ours === null || ours === r.costUsd) continue
    if (isZero) {
      toReprice.push({ id: r.id, from: r.costUsd, to: ours, zero: true })
    } else if (Math.abs(ours - r.costUsd) > NONZERO_TOLERANCE_USD) {
      toReprice.push({ id: r.id, from: r.costUsd, to: ours, zero: false })
    }
  }

  console.log("\nPer model (stored = what tokscale recorded, ours = Anthropic rates):\n")
  const header = [
    "model".padEnd(32),
    "rows".padStart(6),
    "tokens".padStart(12),
    "stored".padStart(11),
    "ours".padStart(11),
    "$0 rows".padStart(8),
    "unpriced".padStart(9),
  ].join("  ")
  console.log(header)
  console.log("-".repeat(header.length))
  for (const [model, b] of [...byModel.entries()].sort(
    (a, z) => z[1].tokens - a[1].tokens
  )) {
    console.log(
      [
        model.slice(0, 32).padEnd(32),
        String(b.rows).padStart(6),
        b.tokens.toLocaleString("en-US").padStart(12),
        usd(b.storedCost).padStart(11),
        usd(b.ourCost).padStart(11),
        String(b.zeroCostRows).padStart(8),
        String(b.unpriced).padStart(9),
      ].join("  ")
    )
  }

  const zeros = toReprice.filter((t) => t.zero)
  const nonZeros = toReprice.filter((t) => !t.zero)
  const sum = (xs: typeof toReprice) => xs.reduce((a, t) => a + (t.to - t.from), 0)

  console.log(
    `\nZero-cost rows to fill: ${zeros.length} (adds ${usd(sum(zeros))})` +
      `\nNon-zero rows disagreeing by >${usd(NONZERO_TOLERANCE_USD)}: ${nonZeros.length}` +
      ` (would shift ${usd(sum(nonZeros))})`
  )

  const targets = INCLUDE_NONZERO ? toReprice : zeros
  if (!APPLY) {
    console.log(
      `\nDry run — nothing written. ${targets.length} row(s) would change.` +
        `\nRe-run with --apply to write them.`
    )
    for (const t of targets.slice(0, 20)) {
      console.log(`  ${t.id}  ${usd(t.from)} -> ${usd(t.to)}`)
    }
    if (targets.length > 20) console.log(`  … and ${targets.length - 20} more`)
    return
  }

  if (targets.length === 0) {
    console.log("\nNothing to write.")
    return
  }

  // Chunked so a large backfill doesn't hold one enormous transaction open on
  // the pooled connection.
  const CHUNK = 100
  let written = 0
  for (let i = 0; i < targets.length; i += CHUNK) {
    const chunk = targets.slice(i, i + CHUNK)
    await prisma.$transaction(
      chunk.map((t) =>
        prisma.tokenUsage.update({
          where: { id: t.id },
          data: { costUsd: t.to },
        })
      )
    )
    written += chunk.length
    console.log(`  wrote ${written}/${targets.length}`)
  }
  console.log(`\nDone. Repriced ${written} row(s).`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
