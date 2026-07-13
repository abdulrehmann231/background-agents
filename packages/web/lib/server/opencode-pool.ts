/**
 * Shared OpenCode key pool (server-only).
 *
 * The shared OpenCode pool is backed by `OPENCODE_API_KEY`, which may hold a
 * single key or several comma-separated keys. When multiple are set, each shared
 * run picks one uniformly at random (equal chance across all N), which lets an
 * operator run several keys concurrently instead of manually swapping a single
 * key on a schedule. With one key, behaviour is unchanged.
 *
 * Never imported from client code — reads raw key values from process.env.
 */

/**
 * The configured shared-pool keys, parsed from the comma-separated
 * `OPENCODE_API_KEY`, trimmed with blanks dropped.
 */
export function getSharedOpencodeKeys(): string[] {
  return (process.env.OPENCODE_API_KEY ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter((k) => !!k)
}

/** Whether the server has at least one shared OpenCode key configured. */
export function hasSharedOpencodeKey(): boolean {
  return getSharedOpencodeKeys().length > 0
}

/**
 * Pick one shared OpenCode key uniformly at random, or undefined when none are
 * configured. Called per shared run so usage spreads evenly across the pool —
 * every key has an equal chance.
 */
export function pickSharedOpencodeKey(): string | undefined {
  const keys = getSharedOpencodeKeys()
  if (keys.length === 0) return undefined
  return keys[Math.floor(Math.random() * keys.length)]
}
