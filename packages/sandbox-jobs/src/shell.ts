/**
 * Tiny, dependency-free shell + parsing helpers. All shell-string construction
 * in this package goes through `q()` — there is no other quoting path, so the
 * injection surface is one audited function.
 */

/** Single-quote a string for safe embedding in a POSIX shell command. */
export function q(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

/** Default parent directory for job directories. */
export const DEFAULT_ROOT = "/tmp/sandbox-jobs"

/**
 * Absolute cgroup-v2 path for a job. Derived purely from the job id so a cold
 * caller (attach()) can reconstruct it without reading meta. The id is
 * `<unix-ms>-<base36>` — only filesystem-safe characters — so it needs no
 * escaping in `/sys/fs/cgroup`.
 */
export function cgroupPath(jobId: string): string {
  return `/sys/fs/cgroup/sbj-${jobId}`
}

/**
 * Time-sortable, collision-resistant id: `<unix-ms>-<base36 random>`. The
 * timestamp prefix makes `ls` chronological and age-based cleanup trivial; the
 * random suffix avoids collisions when two jobs start in the same millisecond.
 */
export function makeJobId(now: number): string {
  const rand = Math.random().toString(36).slice(2, 8)
  return `${now}-${rand}`
}

/**
 * Split a freshly-read payload at the last newline. Returns the complete-line
 * prefix (what we commit and advance the cursor past) and how many bytes it
 * occupied. A trailing partial line is left unconsumed for the next read.
 */
export function splitComplete(payload: string): {
  complete: string
  consumedBytes: number
} {
  const lastNewline = payload.lastIndexOf("\n")
  if (lastNewline === -1) return { complete: "", consumedBytes: 0 }
  const complete = payload.slice(0, lastNewline + 1)
  return { complete, consumedBytes: Buffer.byteLength(complete, "utf8") }
}
