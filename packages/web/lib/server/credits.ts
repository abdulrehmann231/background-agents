/**
 * Purchased credits: the unit, and the conversions at its edges.
 *
 * Credits are bought through Stripe, denominated in exactly the same US dollars
 * of API list value the ledger already stores in `TokenUsage.costUsd` — one
 * credit is one dollar, priced by tokscale (and by lib/server/claude-pricing
 * for Claude) with no conversion of any kind in between. That is deliberate: the
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
