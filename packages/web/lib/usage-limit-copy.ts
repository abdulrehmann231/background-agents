import type { Plan } from "@/lib/server/usage-budgets"
import { fmtBalance } from "@/lib/format"

export function isPlan(value: unknown): value is Plan {
  return value === "free" || value === "pro" || value === "unlimited"
}

/**
 * The message shown when a user has nothing left to spend.
 *
 * Only reached when BOTH pots are empty (see lib/db/usage-limit): the day's
 * allowance is spent and purchased credits are at or below zero. So it names
 * both, and says the daily half comes back at UTC midnight — that is true
 * again, and it is the one thing a blocked user can get for free by waiting.
 *
 * Deliberately names no provider: the balance is pooled, so "your Claude limit"
 * was both wrong and confusing once the same allowance covered Gemini and
 * OpenCode. Free models are called out because they genuinely still work — they
 * never draw down the balance — and that is the most useful thing a blocked user
 * can be told.
 *
 * Topping up leads the list of next steps: it is the only one the user can act
 * on immediately and alone. Adding an API key means having one.
 */
export function formatUsageLimitMessage({
  limit,
  creditBalance = 0,
}: {
  /** Today's allowance in USD, so the message can name what was reached. */
  limit: number
  /**
   * Purchased credits in USD. Negative when the turn that emptied them
   * overshot — a cost is only known once the turn has run.
   */
  creditBalance?: number
}): string {
  // A deficit is the one case where waiting does not help: tomorrow's allowance
  // arrives, but the negative balance still blocks every send until it is
  // cleared. Say that instead of promising a reset that will not unblock them.
  if (creditBalance < 0) {
    return (
      `Daily limit reached (${fmtBalance(limit)}), and your last turn ran ` +
      `${fmtBalance(Math.abs(creditBalance))} past your credits. Top up to clear it, ` +
      `add your own API key, or switch to a free model.`
    )
  }

  return (
    `Daily limit reached (${fmtBalance(limit)}) and you're out of credits. ` +
    `Top up to continue, add your own API key, or switch to a free model — ` +
    `or wait for your daily balance to reset at midnight UTC.`
  )
}
