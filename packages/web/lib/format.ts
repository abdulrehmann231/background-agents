/**
 * Shared display formatting helpers for Simple Chat.
 */

/**
 * The final path segment of a file path, for display.
 * "src/lib/foo.ts" → "foo.ts". Falls back to the input when there is no slash.
 */
export function basename(path: string): string {
  return path.split("/").pop() || path
}

/** Compact token count: 950 → "950", 12_345 → "12.3K", 1_200_000 → "1.2M". */
export function fmtTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`
  return `${(n / 1_000_000).toFixed(1)}M`
}

/**
 * Format a usage amount in its budget unit:
 *   cost     → "$1.23", or "<$0.01" for a nonzero amount that rounds to nothing
 *   messages → "3 messages" / "1 message"
 *   tokens   → "12.3K tokens"
 *
 * The sub-cent case matters: a daily cost budget is a fraction of a dollar, so
 * the first turn of the day would otherwise read "$0.00 used" and look broken.
 */
export function fmtBudgetAmount(n: number, unit: "tokens" | "cost" | "messages"): string {
  if (unit === "cost") return n > 0 && n < 0.005 ? "<$0.01" : `$${n.toFixed(2)}`
  if (unit === "messages") {
    const m = Math.round(n)
    return `${m} ${m === 1 ? "message" : "messages"}`
  }
  return `${fmtTokens(n)} tokens`
}
