/**
 * Purchased credits: units, and the daily-then-credits spend split.
 *
 * Credits are a second balance sitting *behind* the plan's daily allowance.
 * They are bought through Stripe, denominated in exactly the same US dollars of
 * API list value the ledger already stores in `TokenUsage.costUsd` — one credit
 * is one dollar, priced by tokscale (and by lib/server/claude-pricing for
 * Claude) with no conversion of any kind in between. That is deliberate: the
 * number a user buys and the number the meter spends are the same number, so
 * the balance needs no explaining.
 *
 * Free of database imports so the arithmetic can be unit-tested on its own,
 * mirroring lib/server/usage-cursor. The database side lives in lib/db/credits.
 */

/**
 * Micro-dollars per US dollar — the stored unit for balances and ledger rows.
 *
 * Not cents: a turn frequently costs less than one (`fmtBalance` renders
 * `<$0.01`, and `floorCostUsd` exists precisely for those), so rounding each
 * debit up to a cent overcharges and rounding down to zero recreates the
 * free-route-around-the-cap bug token-metering guards against. Not a float
 * either: `snapCostResidue` exists because differencing floats in this ledger
 * lands on 4e-16 instead of 0, and a balance must not accumulate that.
 */
export const MICRO_PER_USD = 1_000_000

/**
 * What a new account is granted on signup, in USD.
 *
 * This is the whole free tier: there is no daily allowance behind it and
 * nothing refills it (see lib/db/usage-limit), so once it is spent the user
 * tops up or runs on their own key. Kept here, next to the unit it is
 * denominated in, so changing the figure is a one-line change rather than a
 * hunt through the auth callbacks and the backfill script that both apply it.
 *
 * Worth sizing deliberately: these are dollars of API list value, and a single
 * agentic run on a real repo can spend several of them.
 */
export const SIGNUP_CREDIT_USD = 5

/**
 * The `externalId` a signup grant is keyed on.
 *
 * That column is uniquely indexed, so this string is what actually prevents a
 * second grant — not a prior read. The auth callback and the backfill script
 * both build it from here rather than each writing the literal, because a typo
 * in one of them would silently double-credit every user it touched.
 */
export function signupGrantKey(userId: string): string {
  return `signup:${userId}`
}

/** USD → micro-dollars, rounded to the nearest micro-dollar. */
export function usdToMicro(usd: number): bigint {
  if (!Number.isFinite(usd)) return 0n
  return BigInt(Math.round(usd * MICRO_PER_USD))
}

/**
 * Micro-dollars → USD, for display and for JSON responses.
 *
 * Balances are far below 2^53 micro-dollars ($9 billion), so the conversion
 * through `Number` is exact for any value this app will ever hold. It also has
 * to happen at every API boundary regardless: `JSON.stringify` throws on BigInt.
 */
export function microToUsd(micro: bigint): number {
  return Number(micro) / MICRO_PER_USD
}

/**
 * A Stripe amount (integer minor units — cents, for USD) → micro-dollars.
 *
 * Deliberately not routed through `usdToMicro`: Stripe already hands us an
 * exact integer, and dividing it by 100 to get dollars and multiplying back up
 * would put a float in the middle of the one number in this system that a user
 * actually paid. 1 cent is 10,000 micro-dollars, and BigInt keeps it exact.
 */
export function stripeAmountToMicro(amountInCents: number): bigint {
  if (!Number.isInteger(amountInCents)) return 0n
  return BigInt(amountInCents) * 10_000n
}

/** How a single turn's cost divides between the two balances. */
export interface TurnCostSplit {
  /** Paid out of the plan's daily allowance. */
  fromDaily: number
  /** Paid out of purchased credits. */
  fromCredits: number
}

/**
 * Split one turn's cost between the daily allowance and purchased credits.
 *
 * The allowance always goes first, because it expires at UTC midnight and
 * credits never do — spending a bought dollar while a free one is still on the
 * table is strictly worse for the user. `dailyLeft` is `Infinity` for the
 * `unlimited` plan, which then absorbs the whole cost and never reaches credits.
 *
 * Nothing is clamped to the balance the user actually holds, and that is the
 * point. A run is gated only *before* it starts, so the turn that empties the
 * balance can overshoot it by an unbounded amount — one production run cost
 * $476. That overshoot is real money and is recorded as a negative balance,
 * which the gate then refuses until a top-up clears it. Clamping here would
 * quietly forgive it and make "top up a dollar, run an expensive turn, repeat"
 * a free ride.
 */
export function splitTurnCost({
  cost,
  dailyLeft,
}: {
  /** This turn's chargeable cost in USD. */
  cost: number
  /** Daily allowance remaining *before* this turn, or Infinity when uncapped. */
  dailyLeft: number
}): TurnCostSplit {
  if (!(cost > 0) || !Number.isFinite(cost)) {
    return { fromDaily: 0, fromCredits: 0 }
  }
  const fromDaily = Math.min(cost, Math.max(0, dailyLeft))
  return { fromDaily, fromCredits: cost - fromDaily }
}
