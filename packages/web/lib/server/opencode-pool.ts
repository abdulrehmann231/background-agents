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

/** Number of trailing characters kept as a key's public fingerprint. */
const KEY_FINGERPRINT_LENGTH = 5

/**
 * Public fingerprint for a pool key: its last {@link KEY_FINGERPRINT_LENGTH}
 * characters. Stored on TokenUsage rows so spend can be attributed per key, and
 * rendered in the admin dashboard as e.g. "…Ca2RK".
 *
 * Deliberately lossy — five characters is enough to tell a handful of pool keys
 * apart (~916M combinations over the alphanumeric alphabet OpenCode uses) while
 * being useless for reconstructing the credential. Never log or persist the
 * full key.
 *
 * Returns undefined for a missing or too-short key so callers can simply omit
 * the field rather than storing a meaningless value.
 */
export function fingerprintKey(key: string | undefined | null): string | undefined {
  if (!key) return undefined
  const trimmed = key.trim()
  if (trimmed.length < KEY_FINGERPRINT_LENGTH) return undefined
  return trimmed.slice(-KEY_FINGERPRINT_LENGTH)
}
