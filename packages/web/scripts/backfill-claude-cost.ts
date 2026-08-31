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
 * the safe, obviously-wrong set. `--include-nonzero` additionally raises rows
 * tokscale under-priced — in practice ones where it dropped cache entirely and
 * billed input+output only, its observed failure mode, which produces wrong
 * non-zero costs rather than zeros.
 *
 * Repricing only ever moves a cost UP. Rows where tokscale priced *higher* than
 * we do are reported but never rewritten: those are most likely 1-hour cache
 * writes (2x input) that we bill at the 5-minute 1.25x rate because tokscale
 * reports no TTL — so tokscale is probably the more accurate of the two, and
 * rewriting them down would trade a likely-right number for a likely-wrong one.
 *
 * Before writing, the original costUsd of every affected row is dumped to a
 * timestamped JSON file beside this script, so a run can be undone.
 */

import { writeFileSync } from "node:fs"
import path from "node:path"

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
  /** Rows where tokscale priced HIGHER than us — reported, never rewritten. */
  const overpriced: number[] = []

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
    } else if (ours - r.costUsd > NONZERO_TOLERANCE_USD) {
      // Only ever correct UPWARD. A row where we price higher than tokscale is
      // one where tokscale dropped a component we can account for (in practice:
      // cache, priced as input+output only). A row where we price *lower* is
      // more likely a gap on our side — most plausibly a 1-hour cache write,
      // which bills at 2x input while we assume the 5-minute 1.25x rate because
      // tokscale reports no TTL. Rewriting those down would replace a probably-
      // right number with a probably-wrong one, so leave them alone.
      toReprice.push({ id: r.id, from: r.costUsd, to: ours, zero: false })
    } else if (r.costUsd - ours > NONZERO_TOLERANCE_USD) {
      overpriced.push(r.costUsd - ours)
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

  const overpricedTotal = overpriced.reduce((a, b) => a + b, 0)
  console.log(
    `\nZero-cost rows to fill:      ${zeros.length} (adds ${usd(sum(zeros))})` +
      `\nUnder-priced rows to raise:  ${nonZeros.length} (adds ${usd(sum(nonZeros))})` +
      `\nOver-priced rows LEFT ALONE: ${overpriced.length} (would have removed ` +
      `${usd(overpricedTotal)}; likely 1h cache writes we under-price, so ` +
      `tokscale is probably the more accurate of the two there)`
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

  // Snapshot the originals before overwriting them. Repricing is the one step
  // here that loses information: the ledger's per-row costUsd is what tokscale
  // believed at the time, and nothing else records it (cumulativeCost is a
  // running session total, not a per-row original). Dump it next to the script
  // so a bad run can be reversed.
  const backupPath = path.join(
    __dirname,
    `backfill-claude-cost.backup.${new Date().toISOString().replace(/[:.]/g, "-")}.json`
  )
  writeFileSync(
    backupPath,
    JSON.stringify(
      targets.map((t) => ({ id: t.id, costUsd: t.from, repricedTo: t.to })),
      null,
      2
    )
  )
  console.log(`\nOriginals saved to ${backupPath}`)

  // Small concurrent batches rather than one interactive transaction: over a
  // pgbouncer pooler a 100-update transaction blows Prisma's 5s limit (P2028)
  // and rolls the whole thing back. Each row is independent and the reprice is
  // idempotent — it recomputes from the token components every run — so a
  // partial pass is harmless and re-running simply finishes the job.
  const CHUNK = 20
  let written = 0
  for (let i = 0; i < targets.length; i += CHUNK) {
    const chunk = targets.slice(i, i + CHUNK)
    await Promise.all(
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
