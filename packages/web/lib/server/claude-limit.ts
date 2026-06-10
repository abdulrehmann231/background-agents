/**
 * In-memory Claude provider-limit cache (server-only).
 *
 * Tracks how close the *active* Claude account is to its real provider quota
 * (Anthropic's rolling 5-hour "Session" + "Weekly" windows), as reported by
 * `tokscale usage --json`. This is NOT the app's own 10/day message counter —
 * it's the upstream subscription cap.
 *
 * Design (intentionally simple, no persistence):
 *  - The cache lives in process memory only. Nothing is written to the DB or
 *    disk; reset times are kept in memory and discarded on restart.
 *  - It is refreshed at well-known moments (after a Claude turn completes, and
 *    invalidated when credentials change) — never on the hot send path.
 *  - At send time the message route only *reads* this cache (synchronous, no
 *    tokscale call) to decide whether to switch the turn to the shared
 *    OpenCode Go pool.
 *
 * Scope keys:
 *  - "shared:claude"  → the one shared OAuth account used by all free users
 *                       (global: one account → everyone is limited together).
 *  - "user:<userId>"  → a user running on their own Claude subscription token.
 */

/**
 * Switch when the worst window (Session/5hr OR Weekly) has <= this % remaining
 * ("about to hit"). Currently 20% for testing — raise/lower as needed.
 */
const SWITCH_AT_REMAINING_PERCENT = 20

interface ClaudeQuota {
  /** Worst (lowest) remaining percent across all reported windows, 0..100. */
  remainingPercent: number
  /** Epoch ms when the tripped window resets (in-memory only). */
  resetAt?: number
  /** Whether the account is at/near its provider limit. */
  limited: boolean
  /** When this entry was last refreshed (epoch ms). */
  fetchedAt: number
}

/** Minimal shape of the Daytona sandbox we need (matches `daytona.get(...)`). */
interface SandboxLike {
  process: {
    executeCommand(
      command: string,
      cwd?: string,
      env?: Record<string, string>,
      timeout?: number
    ): Promise<{ exitCode?: number; result?: string }>
  }
}

// Pin the cache on globalThis. Next.js compiles each route into its own bundle,
// so a plain module-level `const cache` is instantiated separately per route
// (the writer in /api/agent/stream and the reader in /api/chats/.../messages
// would each get their own Map). globalThis is the single process-wide object
// shared across all bundles, and it also survives dev HMR recompiles.
// NOTE: this shares within ONE Node process only — with multiple server
// instances (horizontal scale / serverless) each has its own cache. That's an
// accepted limitation of the in-memory design; the after-turn refresh on each
// instance converges it.
const globalForClaudeLimit = globalThis as unknown as {
  __claudeLimitCache?: Map<string, ClaudeQuota>
}
const cache: Map<string, ClaudeQuota> =
  globalForClaudeLimit.__claudeLimitCache ??
  (globalForClaudeLimit.__claudeLimitCache = new Map<string, ClaudeQuota>())

/**
 * Resolve the cache scope for a user. Users with their own subscription token
 * are tracked separately; everyone else shares the global pool key.
 */
export function claudeLimitScope(
  userId: string,
  credentials: { CLAUDE_CODE_CREDENTIALS?: string }
): string {
  return credentials.CLAUDE_CODE_CREDENTIALS ? `user:${userId}` : "shared:claude"
}

/**
 * Send-path read (synchronous, no network). Returns true when the active Claude
 * account is at/near its provider limit and the turn should be routed to the
 * shared OpenCode pool instead. Lazily clears entries whose reset time passed.
 */
export function shouldSwitchFromClaude(scope: string): boolean {
  const q = cache.get(scope)
  if (!q) {
    console.log(`[claude-limit] read scope=${scope} → no cache entry (no switch)`)
    return false
  }
  if (!q.limited) {
    console.log(
      `[claude-limit] read scope=${scope} → remaining=${q.remainingPercent}% not limited (no switch)`
    )
    return false
  }
  if (q.resetAt && Date.now() >= q.resetAt) {
    // The provider window has reset — Claude is usable again.
    console.log(`[claude-limit] read scope=${scope} → window reset, clearing (no switch)`)
    cache.delete(scope)
    return false
  }
  console.log(
    `[claude-limit] read scope=${scope} → LIMITED (remaining=${q.remainingPercent}%, resetAt=${
      q.resetAt ? new Date(q.resetAt).toISOString() : "n/a"
    }) → SWITCH`
  )
  return true
}

/** Drop a cached entry so the next refresh repopulates it (e.g. on cred change). */
export function invalidateClaudeLimit(scope: string): void {
  cache.delete(scope)
}

/**
 * Extract the first top-level JSON array from mixed stdout/stderr output.
 * tokscale can emit non-JSON noise (e.g. a LiteLLM warning) around the payload.
 */
function extractJsonArray(raw: string): unknown[] | null {
  const start = raw.indexOf("[")
  const end = raw.lastIndexOf("]")
  if (start === -1 || end === -1 || end <= start) return null
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1))
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

/**
 * Refresh the cache for `scope` by running `tokscale usage --json` in the
 * sandbox. tokscale reads `~/.claude/.credentials.json` — i.e. whichever
 * account actually ran the turn (the user's own token or the shared pool) — so
 * no credential plumbing is needed here. Best-effort: never throws.
 */
export async function refreshClaudeLimit(
  sandbox: SandboxLike,
  scope: string
): Promise<void> {
  try {
    // Note: the `usage` subcommand rejects --no-spinner; call it bare.
    const res = await sandbox.process.executeCommand("tokscale usage --json")
    const raw = res.result ?? ""
    console.log(
      `[claude-limit] refresh scope=${scope} exitCode=${res.exitCode ?? "?"} rawOutput=${JSON.stringify(
        raw.slice(0, 800)
      )}`
    )

    const providers = extractJsonArray(raw)
    if (!providers) {
      console.warn(`[claude-limit] refresh scope=${scope} → could not parse JSON array from output`)
      return
    }

    const claude = providers.find(
      (p): p is { metrics?: unknown[] } =>
        !!p &&
        typeof p === "object" &&
        String((p as { provider?: unknown }).provider).toLowerCase() === "claude"
    )
    const metrics = Array.isArray(claude?.metrics) ? claude.metrics : []
    console.log(
      `[claude-limit] refresh scope=${scope} → providers=${providers.length}, claudeFound=${!!claude}, metrics=${metrics.length}`
    )
    if (metrics.length === 0) {
      // No subscription quota for this account (e.g. API-key user) → not limited.
      cache.delete(scope)
      console.log(`[claude-limit] refresh scope=${scope} → no Claude metrics, cleared cache`)
      return
    }

    let worstRemaining = 100
    let resetAt: number | undefined
    for (const m of metrics as Array<Record<string, unknown>>) {
      const remaining =
        typeof m.remaining_percent === "number"
          ? m.remaining_percent
          : typeof m.used_percent === "number"
            ? 100 - m.used_percent
            : 100
      console.log(
        `[claude-limit]   window label=${String(m.label)} remaining=${remaining}% resets_at=${String(
          m.resets_at
        )}`
      )
      if (remaining < worstRemaining) {
        worstRemaining = remaining
        const r = m.resets_at
        resetAt = typeof r === "string" ? Date.parse(r) || undefined : undefined
      }
    }

    const limited = worstRemaining <= SWITCH_AT_REMAINING_PERCENT
    cache.set(scope, {
      remainingPercent: worstRemaining,
      resetAt,
      limited,
      fetchedAt: Date.now(),
    })
    console.log(
      `[claude-limit] refresh scope=${scope} → worstRemaining=${worstRemaining}% threshold=${SWITCH_AT_REMAINING_PERCENT}% limited=${limited} resetAt=${
        resetAt ? new Date(resetAt).toISOString() : "n/a"
      }`
    )
  } catch (err) {
    // Best-effort: leave any existing entry in place.
    console.error(`[claude-limit] refresh failed for ${scope}:`, err)
  }
}
