/**
 * Credits: units, the grants, the shared-pool discount, and the spend split.
 *
 * Credits are the only balance that gates a send (see lib/db/usage-limit).
 * They arrive as a grant on signup, are topped up a little each day, and are
 * otherwise bought through Stripe.
 *
 * A credit is a US dollar, but it is NOT a dollar of API list value. The ledger
 * stores list value in `TokenUsage.costUsd` — what the tokens would have cost
 * at published rates — and a turn is charged that figure divided by
 * {@link DISCOUNT_DIVISOR} for its provider. The divisor exists because the
 * shared pools are not bought at list: Claude runs on a flat Max 20x
 * subscription that returned ~33× its cost over the first 83 days of the
 * ledger, so billing a user list value would overcharge them by roughly that
 * factor.
 *
 * The two numbers are kept apart rather than reconciled. `costUsd` stays list
 * value, because every admin rollup and every threshold in
 * lib/server/turn-pricing is calibrated against it and rewriting its meaning
 * would silently reinterpret all existing history. The discounted figure is
 * what lands in `CreditTransaction.amountMicroUsd`, alongside the list value
 * and the divisor in force, so a row stays explainable after the divisors move.
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
 * What a metered turn's list value is divided by before it reaches the balance,
 * keyed by the internal provider id (`TokenUsage.provider`).
 *
 * These are the free tier's real dial, and they are expected to move. Anything
 * not listed divides by {@link NO_DISCOUNT} — a provider we have no subsidised
 * pool for is charged what it is worth.
 *
 * Sized against what the pools actually cost us rather than picked round:
 * Claude is a flat Max 20x subscription (~33× its price in list value over the
 * ledger's first 83 days), while OpenCode and Gemini are metered keys bought
 * near list, so their subsidy is deliberately much smaller.
 *
 * Note the interaction with {@link SIGNUP_CREDIT_USD}: the grant is denominated
 * in credits, so raising a divisor makes the same grant go further on that
 * provider and only that provider.
 */
export const DISCOUNT_DIVISOR: Readonly<Record<string, number>> = {
  claude: 20,
  opencode: 2,
  gemini: 2,
}

/** The divisor for a provider we do not subsidise: charge list value. */
const NO_DISCOUNT = 1

/**
 * The divisor to charge `provider` at.
 *
 * Falls back to {@link NO_DISCOUNT} for an unknown provider *and* for a
 * nonsensical entry (zero, negative, non-finite). A mistyped constant must
 * never make a turn free or credit the user for running one — that is the same
 * hazard `floorCostUsd` guards in lib/server/turn-pricing, one layer down.
 */
export function discountDivisorFor(provider: string): number {
  const divisor = DISCOUNT_DIVISOR[provider]
  if (typeof divisor !== "number" || !Number.isFinite(divisor) || divisor <= 0) {
    return NO_DISCOUNT
  }
  return divisor
}

/**
 * A turn's list value → what actually comes off the balance.
 *
 * The inverse is `chargedUsd * discountDivisorFor(provider)`, which is why the
 * divisor is stamped on every debit row: it is the only thing that makes an old
 * charge reproducible once these constants change.
 */
export function chargeableUsd(provider: string, listUsd: number): number {
  if (!Number.isFinite(listUsd) || listUsd <= 0) return 0
  return listUsd / discountDivisorFor(provider)
}

/**
 * What a new account is granted on signup, in credits.
 *
 * Kept here, next to the unit it is denominated in, so changing the figure is a
 * one-line change rather than a hunt through the auth callbacks and the backfill
 * script that both apply it. The one copy that does not follow it is the literal
 * in migration 20260905120000_backfill_signup_credits, frozen on purpose: a
 * migration records what was actually granted on the day it ran.
 *
 * Worth sizing against {@link DISCOUNT_DIVISOR} rather than in the abstract. At
 * the divisors above this buys roughly two Claude turns, six paid OpenCode turns
 * or nine Gemini turns, measured on the ledger's own per-turn averages. It is no
 * longer the whole free tier — {@link DAILY_CREDIT_USD} refills behind it — so it
 * only has to cover a first session, not a relationship.
 */
export const SIGNUP_CREDIT_USD = 0.25

/**
 * Added to every eligible balance once per UTC day, in credits.
 *
 * Applied by the daily-credits cron, not by anything on the request path, so a
 * user who never returns costs nothing to keep topped up.
 */
export const DAILY_CREDIT_USD = 0.25

/**
 * The daily top-up only applies to a balance strictly below this, in credits.
 *
 * Two jobs. It stops a dormant account accruing without bound — the standing
 * liability across all users is bounded at roughly `DAILY_CREDIT_CAP +
 * DAILY_CREDIT_USD` each, not a year's worth. And it makes the top-up a floor
 * rather than an income: a user who tops up properly is not also handed change
 * every night.
 *
 * Deliberately no lower bound. A negative balance — the deficit left by the turn
 * that overshot zero — is topped up like any other, so an account digs itself
 * out at `DAILY_CREDIT_USD` a day instead of being bricked until it pays. That
 * is a reversal of the reasoning that removed the old daily allowance (a reset
 * re-opened the gate on a deficit and let it be re-incurred nightly), and it is
 * a deliberate one: at this size the worst case is a slow drip, and a permanent
 * lockout on a free account is worse.
 */
export const DAILY_CREDIT_CAP = 1

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
 * $476 of list value, which is still $23.80 of credits at today's Claude
 * divisor. That overshoot is recorded as a negative balance, which the gate
 * refuses until a top-up (or enough daily credits) clears it. Clamping here
 * would quietly forgive it and make "top up a dollar, run an expensive turn,
 * repeat" a free ride.
 */
export function splitTurnCost({
  cost,
  dailyLeft,
}: {
  /** This turn's chargeable cost in credits, i.e. already discounted. */
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
