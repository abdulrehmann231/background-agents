/**
 * In-memory provider-limit cache (server-only).
 *
 * Tracks how close the *active* account for each subscription provider that
 * `tokscale usage` supports — Claude, Codex, Copilot — is to its real rolling
 * quota. This is NOT the app's own 10/day message counter; it's the upstream
 * subscription cap. A single `tokscale usage --json` call returns all providers
 * at once, so one refresh updates every provider whose creds are present.
 *
 * Design (intentionally simple, no persistence):
 *  - The cache lives in process memory only (pinned on globalThis so it's shared
 *    across Next.js route bundles and survives dev HMR). Nothing is persisted.
 *  - Refreshed after a monitored turn completes; invalidated on cred change.
 *  - At send time the message route only *reads* this cache (synchronous) to
 *    decide whether to route the turn to the OpenCode free model instead.
 *
 * Scope keys: `${provider}:${account}` where account is `shared` (the one
 * shared Claude OAuth pool) or `user:<userId>` (a user's own subscription).
 * Only Claude has a shared pool; Codex/Copilot are always user-owned.
 */

/**
 * Switch when the worst window has <= this % remaining ("about to hit").
 * Currently 50 for testing — set to the intended production value when done.
 */
const SWITCH_AT_REMAINING_PERCENT = 50

/** Agents we monitor → the provider name `tokscale usage` reports (lowercased). */
const AGENT_USAGE_PROVIDER: Record<string, string> = {
  "claude-code": "claude",
  codex: "codex",
  copilot: "copilot",
}

interface ProviderQuota {
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
const globalForProviderLimit = globalThis as unknown as {
  __providerLimitCache?: Map<string, ProviderQuota>
}
const cache: Map<string, ProviderQuota> =
  globalForProviderLimit.__providerLimitCache ??
  (globalForProviderLimit.__providerLimitCache = new Map<string, ProviderQuota>())

/** Whether this agent has a subscription quota we can monitor via tokscale. */
export function isMonitoredAgent(agent: string): boolean {
  return agent in AGENT_USAGE_PROVIDER
}

/**
 * Cache scope for an (agent, account). Claude has a shared pool; everyone else
 * is keyed by the user. Returns null for non-monitored agents.
 */
export function providerLimitScope(
  agent: string,
  userId: string,
  credentials: { CLAUDE_CODE_CREDENTIALS?: string }
): string | null {
  const provider = AGENT_USAGE_PROVIDER[agent]
  if (!provider) return null
  if (agent === "claude-code") {
    return credentials.CLAUDE_CODE_CREDENTIALS ? `claude:user:${userId}` : "claude:shared"
  }
  return `${provider}:user:${userId}`
}

/** Map a tokscale provider name → cache scope, for the refresh path. */
function scopeForProvider(
  providerLower: string,
  userId: string,
  credentials: { CLAUDE_CODE_CREDENTIALS?: string }
): string | null {
  if (providerLower === "claude") {
    return credentials.CLAUDE_CODE_CREDENTIALS ? `claude:user:${userId}` : "claude:shared"
  }
  if (providerLower === "codex") return `codex:user:${userId}`
  if (providerLower === "copilot") return `copilot:user:${userId}`
  return null
}

/**
 * Send-path read (synchronous, no network). Returns true when the account for
 * `scope` is at/near its provider limit and the turn should be routed to the
 * OpenCode free model. Lazily clears entries whose reset time passed.
 */
export function shouldSwitchFromProvider(scope: string): boolean {
  const q = cache.get(scope)
  if (!q) {
    console.log(`[provider-limit] read scope=${scope} → no cache entry (no switch)`)
    return false
  }
  if (!q.limited) {
    console.log(
      `[provider-limit] read scope=${scope} → remaining=${q.remainingPercent}% not limited (no switch)`
    )
    return false
  }
  if (q.resetAt && Date.now() >= q.resetAt) {
    // The provider window has reset — the provider is usable again.
    console.log(`[provider-limit] read scope=${scope} → window reset, clearing (no switch)`)
    cache.delete(scope)
    return false
  }
  console.log(
    `[provider-limit] read scope=${scope} → LIMITED (remaining=${q.remainingPercent}%, resetAt=${
      q.resetAt ? new Date(q.resetAt).toISOString() : "n/a"
    }) → SWITCH`
  )
  return true
}

/**
 * Quiet read (no logging, no mutation) of whether the scope is currently
 * limited. Used to expose the state to the client via credential flags so the
 * UI can show the switch instantly instead of waiting for the send round-trip.
 */
export function isProviderLimited(scope: string): boolean {
  const q = cache.get(scope)
  if (!q || !q.limited) return false
  if (q.resetAt && Date.now() >= q.resetAt) return false
  return true
}

/** Drop a cached entry so the next refresh repopulates it. */
export function invalidateProviderLimit(scope: string): void {
  cache.delete(scope)
}

/** Drop all of a user's per-account entries (e.g. on a credential change). */
export function invalidateUserProviderLimits(userId: string): void {
  const suffix = `:user:${userId}`
  for (const key of cache.keys()) {
    if (key.endsWith(suffix)) cache.delete(key)
  }
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

/** Worst (lowest) remaining % + its reset time across a provider's windows. */
function worstWindow(metrics: Array<Record<string, unknown>>): {
  worstRemaining: number
  resetAt?: number
} {
  let worstRemaining = 100
  let resetAt: number | undefined
  for (const m of metrics) {
    const remaining =
      typeof m.remaining_percent === "number"
        ? m.remaining_percent
        : typeof m.used_percent === "number"
          ? 100 - m.used_percent
          : 100
    if (remaining < worstRemaining) {
      worstRemaining = remaining
      const r = m.resets_at
      // Handles both full ISO timestamps and date-only values (e.g. Copilot's
      // "2026-07-01"), which Date.parse reads as UTC midnight.
      resetAt = typeof r === "string" ? Date.parse(r) || undefined : undefined
    }
  }
  return { worstRemaining, resetAt }
}

/**
 * Refresh the cache for ALL monitored providers by running `tokscale usage
 * --json` once in the sandbox. tokscale reads each provider's local creds
 * (`~/.claude/.credentials.json`, `~/.config/codex/auth.json`, the GitHub
 * token), so whichever accounts are present get refreshed. Best-effort.
 */
export async function refreshProviderLimits(
  sandbox: SandboxLike,
  userId: string,
  credentials: { CLAUDE_CODE_CREDENTIALS?: string }
): Promise<void> {
  try {
    // Note: the `usage` subcommand rejects --no-spinner; call it bare.
    const res = await sandbox.process.executeCommand("tokscale usage --json")
    const raw = res.result ?? ""
    console.log(
      `[provider-limit] refresh user=${userId} exitCode=${res.exitCode ?? "?"} rawOutput=${JSON.stringify(
        raw.slice(0, 1000)
      )}`
    )

    const providers = extractJsonArray(raw)
    if (!providers) {
      console.warn(`[provider-limit] refresh user=${userId} → could not parse JSON array`)
      return
    }

    for (const p of providers) {
      if (!p || typeof p !== "object") continue
      const entry = p as { provider?: unknown; metrics?: unknown }
      const providerLower = String(entry.provider).toLowerCase()
      const scope = scopeForProvider(providerLower, userId, credentials)
      if (!scope) continue // a provider we don't route on (e.g. z.ai, amp)

      const metrics = Array.isArray(entry.metrics)
        ? (entry.metrics as Array<Record<string, unknown>>)
        : []
      if (metrics.length === 0) {
        cache.delete(scope)
        console.log(`[provider-limit] refresh scope=${scope} → no metrics, cleared`)
        continue
      }

      const { worstRemaining, resetAt } = worstWindow(metrics)
      const limited = worstRemaining <= SWITCH_AT_REMAINING_PERCENT
      cache.set(scope, { remainingPercent: worstRemaining, resetAt, limited, fetchedAt: Date.now() })
      console.log(
        `[provider-limit] refresh scope=${scope} → worstRemaining=${worstRemaining}% threshold=${SWITCH_AT_REMAINING_PERCENT}% limited=${limited} resetAt=${
          resetAt ? new Date(resetAt).toISOString() : "n/a"
        }`
      )
    }
  } catch (err) {
    // Best-effort: leave any existing entries in place.
    console.error(`[provider-limit] refresh failed for user=${userId}:`, err)
  }
}
