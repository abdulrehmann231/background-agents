/**
 * The two rules that stop a metered turn from costing $0.
 *
 * Both exist because the daily balance (lib/server/usage-budgets) is the only
 * cap on shared-pool usage. A turn that consumes real tokens but records no
 * cost is not a rounding error — it is free, uncapped usage that no limit can
 * see, and it stays that way until somebody notices.
 *
 * Kept free of database imports so they can be unit-tested directly.
 */

/**
 * Model ids that name no model, so no price table can resolve them.
 *
 * `byok-0` is Droid's synthetic entry for a BYOK run (`droid exec -m
 * custom:byok-0`); `<synthetic>` is Claude Code's placeholder for internal
 * calls. Production has both: 15 shared `byok-0` rows over 6.8M tokens, all at
 * $0, because a Gemini model under Droid meters against the shared Gemini pool
 * while reporting an unpriceable id.
 */
const PLACEHOLDER_MODEL_IDS: ReadonlySet<string> = new Set([
  "byok-0",
  "custom:byok-0",
  "<synthetic>",
])

/**
 * Last-resort price for a shared turn nothing else could price, in USD per
 * million tokens.
 *
 * Taken from the cheapest paid model actually in use (`deepseek-v4-flash`,
 * ~$0.0125/M blended over the ledger) so it never over-charges a user for a gap
 * on our side — but never charges zero either.
 */
const FLOOR_USD_PER_MTOK = 0.0125

/**
 * The model id to record and price for a turn: what the CLI reported, unless
 * that is a placeholder naming no model, in which case the model the run was
 * actually started with (from the usage metadata stamped at send time).
 *
 * The reported id wins whenever it names something real — the chat's configured
 * model can drift from what the CLI actually ran, and the CLI is the authority
 * on that.
 *
 * Falls back to the placeholder when no run model is known (an older message, or
 * a turn predating `UsageMeta.model`) so the row is still written; the floor
 * rate is then what keeps it from being free.
 */
export function resolveTurnModel(
  reported: string | null | undefined,
  runModel?: string | null
): string | null {
  if (reported && runModel && PLACEHOLDER_MODEL_IDS.has(reported.toLowerCase())) {
    return runModel
  }
  return reported ?? null
}

/** The floor price for `totalTokens`, in USD. Never zero for a non-empty turn. */
export function floorCostUsd(totalTokens: number): number {
  return (FLOOR_USD_PER_MTOK * totalTokens) / 1_000_000
}

/**
 * Below this, a cost is floating-point noise rather than money.
 *
 * Sized against the production ledger: the largest residue observed there is
 * ~2e-15 and the cheapest genuine charge $2.2e-4, so this sits several orders
 * of magnitude clear of both.
 */
const COST_EPSILON = 1e-9

/**
 * Round a computed cost down to exactly zero when it is only residue.
 *
 * A turn's cost is derived by subtracting a *sum* of floats from a float, so a
 * turn that consumed nothing lands on ~4e-16 rather than 0. Two separate rules
 * test that result against `=== 0`, and both silently stopped working: the
 * floor-rate guard no longer fired for unpriceable shared turns, and the
 * skip-empty-turn check no longer fired at all — which persisted 419 junk rows
 * in production before this existed. Snap the residue before either test.
 */
export function snapCostResidue(costUsd: number): number {
  return costUsd < COST_EPSILON ? 0 : costUsd
}
