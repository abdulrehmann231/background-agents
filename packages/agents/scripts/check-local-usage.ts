/**
 * Local usage validator.
 *
 * Runs `tokscale --json` against the agent logs ON YOUR OWN MACHINE and pipes
 * the output through the REAL SDK normalizer (normalizeTokscaleUsage), so you
 * can confirm per-provider token + cost extraction without Daytona or a rebuilt
 * sandbox image.
 *
 * Prerequisite: you must have actually RUN the agent CLI locally at least once
 * (so it has written native session logs). tokscale reads, per provider:
 *   claude   -> ~/.claude/projects
 *   codex    -> ~/.codex/sessions
 *   gemini   -> ~/.gemini/tmp
 *   goose    -> goose's local session store
 *   opencode -> ~/.local/share/opencode/storage/message
 *
 * Usage (from repo root):
 *   npm run check:usage -w @background-agents/sdk
 *   npm run check:usage -w @background-agents/sdk -- claude codex
 *
 * Tip: run `tokscale clients` first to see which providers have local logs.
 */
import { execFileSync } from "node:child_process"
import {
  normalizeTokscaleUsage,
  extractRows,
  diffUsage,
} from "../src/background/usage"

const DEFAULT_PROVIDERS = ["claude", "codex", "gemini", "goose", "opencode"]
const providers = process.argv.slice(2).length
  ? process.argv.slice(2)
  : DEFAULT_PROVIDERS

/** Run tokscale for one client; try a global install first, then npx. */
function runTokscale(client: string): string | null {
  const args = [
    "--json",
    "--client",
    client,
    "--group-by",
    "session,model",
  ]
  const attempts: [string, string[]][] = [
    ["tokscale", args],
    ["npx", ["-y", "tokscale@latest", ...args]],
  ]
  for (const [cmd, a] of attempts) {
    try {
      return execFileSync(cmd, a, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        maxBuffer: 128 * 1024 * 1024,
      })
    } catch {
      /* try next */
    }
  }
  return null
}

function fmtCost(hasCost: boolean, cost: number): string {
  return hasCost ? `$${cost.toFixed(4)}` : "(unpriced)"
}

console.log("Local tokscale usage check — providers:", providers.join(", "))

for (const p of providers) {
  console.log(`\n=== ${p} ===`)
  const raw = runTokscale(p)
  if (raw === null) {
    console.log("  tokscale not runnable (install it or check PATH)")
    continue
  }

  // Diagnostics: how many entries, and are session ids present? (This is the
  // exact shape the SDK depends on for per-turn diffing.)
  let entries: Record<string, unknown>[] = []
  try {
    entries = extractRows(JSON.parse(raw))
  } catch {
    /* leave empty */
  }
  const sessions = new Set(
    entries
      .map((e) => (e as { sessionId?: unknown }).sessionId)
      .filter((s): s is string => typeof s === "string")
  )

  const u = normalizeTokscaleUsage(raw)
  if (u.totalTokens === 0 && !u.hasCost) {
    console.log("  no local logs found for this provider (run it once, then retry)")
    continue
  }

  console.log(`  entries: ${entries.length}, distinct sessions: ${sessions.size}`)
  console.log(
    `  input=${u.inputTokens} output=${u.outputTokens} ` +
      `cacheRead=${u.cacheReadTokens} cacheWrite=${u.cacheWriteTokens}`
  )
  console.log(
    `  totalTokens=${u.totalTokens}  cost=${fmtCost(u.hasCost, u.costUSD)}`
  )

  // Demonstrate the per-turn diff math the SDK uses: if a session has >1 model
  // row, show that summing then diffing behaves (delta vs empty baseline == total).
  const delta = diffUsage(u, undefined)
  if (delta.totalTokens !== u.totalTokens) {
    console.log("  WARN: diff sanity check failed")
  }
}

console.log(
  "\nNote: these are cumulative totals across local sessions. In the SDK, a" +
    " single turn = (cumulative after the turn) - (cumulative before), via" +
    " diffUsage() against the baseline stored in session meta."
)
