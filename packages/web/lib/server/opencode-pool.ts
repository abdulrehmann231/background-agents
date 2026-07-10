/**
 * Shared OpenCode key pool (server-only).
 *
 * The shared OpenCode pool can be backed by two API keys: the primary
 * `OPENCODE_API_KEY` and an optional `OPENCODE_API_KEY_SECONDARY`. When both are
 * set, each shared run picks one uniformly at random (~50/50), which lets an
 * operator run both keys concurrently instead of manually swapping a single key
 * on a schedule. With only the primary set, behaviour is unchanged.
 *
 * Never imported from client code — reads raw key values from process.env.
 */

/**
 * The configured shared-pool keys (primary + optional secondary), in that
 * order, trimmed with blanks dropped.
 */
export function getSharedOpencodeKeys(): string[] {
  return [process.env.OPENCODE_API_KEY, process.env.OPENCODE_API_KEY_SECONDARY]
    .map((k) => k?.trim())
    .filter((k): k is string => !!k)
}

/** Whether the server has at least one shared OpenCode key configured. */
export function hasSharedOpencodeKey(): boolean {
  return getSharedOpencodeKeys().length > 0
}

/**
 * Pick one shared OpenCode key uniformly at random, or undefined when none are
 * configured. Called per shared run so usage spreads evenly across the pool —
 * with both keys set that's ~50/50.
 */
export function pickSharedOpencodeKey(): string | undefined {
  const keys = getSharedOpencodeKeys()
  if (keys.length === 0) return undefined
  return keys[Math.floor(Math.random() * keys.length)]
}
