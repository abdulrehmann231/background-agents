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
 * Format a balance for display: "$5.00", "$4.20", or "<$0.01".
 *
 * The balance is denominated in dollars of API list value, so it reads as money
 * — "$4.20 of $5.00", not "4.20 credits". The sub-cent case matters: a daily
 * balance is a handful of dollars, so the first turn of the day would otherwise
 * read "$0.00 used" and look broken.
 */
export function fmtBalance(n: number): string {
  return n > 0 && n < 0.005 ? "<$0.01" : `$${n.toFixed(2)}`
}
