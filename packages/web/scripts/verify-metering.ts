/**
 * End-to-end verification of the TokenUsage metering path against a real
 * Daytona sandbox and a real Postgres.
 *
 * Exists because the unit tests only cover the extracted pure helpers
 * (usage-cursor, turn-pricing). meterTurnUsage itself — the tokscale exec, the
 * advisory-lock transaction, the delta arithmetic and the insert — had no
 * coverage at all, and it is the part that was restructured.
 *
 * Run:  npx tsx scripts/verify-metering.ts <sandboxId> <agentSessionId>
 *
 * Writes throwaway rows to whatever DATABASE_URL points at and deletes them
 * again; refuses to run against the production host outright.
 */
import { readFileSync } from "node:fs"

for (const line of readFileSync(".env", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "")
}

const PROD_HOST_MARKER = "us-east-2"
if ((process.env.DATABASE_URL ?? "").includes(PROD_HOST_MARKER)) {
  console.error("refusing to run: DATABASE_URL points at the production host")
  process.exit(1)
}

async function main() {
  const { Daytona } = await import("@daytonaio/sdk")
  const { prisma } = await import("@/lib/db/prisma")
  const { meterAssistantTurn } = await import("@/lib/server/token-metering")

  const [sandboxId, sessionId] = process.argv.slice(2)
  if (!sandboxId || !sessionId) {
    console.error("usage: tsx scripts/verify-metering.ts <sandboxId> <agentSessionId>")
    process.exit(1)
  }

  const TAG = `metering-verify-${Date.now()}`
  let pass = 0
  let fail = 0

  const check = (name: string, ok: boolean, detail: string) => {
    console.log(`   ${ok ? "PASS" : "FAIL"}  ${name} — ${detail}`)
    ok ? pass++ : fail++
  }

  const rows = () =>
    prisma.tokenUsage.findMany({
      where: { sessionId },
      orderBy: { createdAt: "asc" },
    })
  const wipe = () => prisma.tokenUsage.deleteMany({ where: { sessionId } })

  const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY })
  const sandbox = await daytona.get(sandboxId)

  // Seed the minimum graph TokenUsage's foreign keys require.
  const user = await prisma.user.create({
    data: { name: TAG, email: `${TAG}@invalid.test` },
  })
  const chat = await prisma.chat.create({
    data: { userId: user.id, repo: "__new__", agent: "gemini", status: "ready" },
  })
  const message = await prisma.message.create({
    data: {
      chatId: chat.id,
      role: "assistant",
      content: TAG,
      timestamp: BigInt(Date.now()),
      metadata: { usage: { provider: "gemini", pool: "user" } },
    },
  })

  const meter = () =>
    meterAssistantTurn(sandbox, {
      userId: user.id,
      chatId: chat.id,
      messageId: message.id,
      messageMetadata: message.metadata,
      agent: "gemini",
      sessionId,
    })

  try {
    await wipe()

    console.log("\n1. First capture writes exactly one correct row")
    const wrote = await meter()
    let got = await rows()
    check("row count", got.length === 1, `wrote=${wrote} rows=${got.length}`)
    if (got[0]) {
      const r = got[0]
      const sum =
        r.inputTokens +
        r.outputTokens +
        r.cacheReadTokens +
        r.cacheWriteTokens +
        r.reasoningTokens
      check(
        "delta is self-consistent",
        sum === r.totalTokens && r.totalTokens > 0,
        `total=${r.totalTokens} components=${sum} cost=${r.costUsd} model=${r.model}`
      )
      check(
        "cumulative recorded",
        r.cumulativeTotal === r.totalTokens,
        `cumulativeTotal=${r.cumulativeTotal} (first capture, so equals the delta)`
      )
    }

    console.log("\n2. Re-metering the same turn writes nothing (bug 2: no junk row)")
    const wrote2 = await meter()
    got = await rows()
    check(
      "no second row",
      wrote2 === 0 && got.length === 1,
      `wrote=${wrote2} rows=${got.length} (pre-fix this stored a ~4e-16 junk row)`
    )

    console.log("\n3. Concurrent finalizers write exactly one row (bug 1: the race)")
    for (let round = 1; round <= 3; round++) {
      await wipe()
      const results = await Promise.all([meter(), meter(), meter(), meter()])
      got = await rows()
      check(
        `round ${round}`,
        got.length === 1,
        `4 concurrent callers → returned [${results.join(",")}] rows=${got.length}`
      )
    }

    console.log("\n4. Ledger totals are not inflated by the concurrent round")
    const agg = await prisma.tokenUsage.aggregate({
      where: { sessionId },
      _sum: { totalTokens: true, costUsd: true },
    })
    check(
      "single charge",
      (agg._sum.totalTokens ?? 0) === (got[0]?.totalTokens ?? -1),
      `summed=${agg._sum.totalTokens} cost=${agg._sum.costUsd}`
    )
  } finally {
    await wipe()
    await prisma.message.deleteMany({ where: { chatId: chat.id } })
    await prisma.chat.delete({ where: { id: chat.id } })
    await prisma.user.delete({ where: { id: user.id } })
    console.log("\ncleaned up test user/chat/message/rows")
    await prisma.$disconnect()
  }

  console.log(`\n${fail === 0 ? "ALL PASSED" : "FAILURES"}: ${pass} passed, ${fail} failed`)
    process.exit(fail === 0 ? 0 : 1)

}

main()
