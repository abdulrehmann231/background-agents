/**
 * The TokenUsage diff cursor: how a turn's delta finds what was already
 * recorded for its (session, model).
 *
 * Every ledger row holds a per-turn delta, so the sum of prior deltas for a
 * (session, model) equals tokscale's cumulative at the last capture, and the
 * next delta is (current cumulative − that sum). Getting the lookup key wrong
 * therefore does not merely mislabel a row: `prev` falls back to zero and the
 * turn is charged the session's entire history.
 *
 * Kept free of database imports — like lib/server/turn-pricing — so the keying
 * rules can be unit-tested directly.
 */

/** Prior cumulative totals for one (session, model) pair, per component. */
export interface SessionCumulative {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
  totalTokens: number
  costUsd: number
}

export const ZERO_CUMULATIVE: SessionCumulative = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  reasoningTokens: 0,
  totalTokens: 0,
  costUsd: 0,
}

/** Add cursor entries together, skipping any that are absent. */
export function sumCumulatives(
  ...parts: (SessionCumulative | undefined)[]
): SessionCumulative {
  const out: SessionCumulative = { ...ZERO_CUMULATIVE }
  for (const part of parts) {
    if (!part) continue
    out.inputTokens += part.inputTokens
    out.outputTokens += part.outputTokens
    out.cacheReadTokens += part.cacheReadTokens
    out.cacheWriteTokens += part.cacheWriteTokens
    out.reasoningTokens += part.reasoningTokens
    out.totalTokens += part.totalTokens
    out.costUsd += part.costUsd
  }
  return out
}

/**
 * The cursor for a turn, given the prior deltas grouped by the model id as
 * *stored*.
 *
 * `reported` is the id tokscale printed; `resolved` is what resolveTurnModel
 * turned it into and therefore what the row is filed under. Those differ
 * whenever the CLI emits a placeholder (Droid's `byok-0`, Claude Code's
 * `<synthetic>`), and looking up by `reported` — as this did until we found 41
 * (session, model) pairs in production re-charging their whole cumulative —
 * misses every row written under the resolved id.
 *
 * Both keys are summed rather than preferred one over the other: a session
 * straddling this fix has rows under each id, and they describe the same model
 * stream. Taking only one half would understate the cursor and overcharge the
 * turn by whatever the other half held.
 */
export function cursorForModel(
  prior: Map<string, SessionCumulative>,
  reported: string | null | undefined,
  resolved: string | null | undefined
): SessionCumulative {
  const key = resolved ?? ""
  const rawKey = reported ?? ""
  return sumCumulatives(
    prior.get(key),
    rawKey !== key ? prior.get(rawKey) : undefined
  )
}
