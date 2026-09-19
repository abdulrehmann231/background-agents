import { NextRequest } from "next/server"
import {
  requireAuth,
  isAuthError,
  getChatWithAuth,
  internalError,
  badRequest,
} from "@/lib/db/api-helpers"
import { getEffectiveCredentialFlags } from "@/lib/server/credential-flags"
import { getCostEstimate } from "@/lib/db/cost-stats"
import { sharedPoolProviderForModel, type Agent } from "@background-agents/common"

export interface CostEstimateResponse {
  /** USD the next turn starts around, or null when there is nothing to show. */
  fromUsd: number | null
}

/**
 * How long an estimate is reused before it is recomputed.
 *
 * Short enough that a new chat crossing the sample floor starts showing its own
 * number within minutes, long enough that a burst of model switches does not put
 * a 60-day aggregate on the database each time.
 */
const TTL_MS = 5 * 60 * 1000

/** Bounded so a long-lived instance cannot accumulate a key per chat forever. */
const MAX_ENTRIES = 500

const cache = new Map<string, { at: number; value: number | null }>()

async function cached(
  key: string,
  compute: () => Promise<number | null>
): Promise<number | null> {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value

  const value = await compute()

  // Oldest-first eviction: `Map` preserves insertion order, and re-inserting on
  // every write keeps the recently used keys at the back.
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.delete(key)
  cache.set(key, { at: Date.now(), value })

  return value
}

// =============================================================================
// GET - what the next turn starts around
// =============================================================================

/**
 * The floor price of the turn the user is about to send.
 *
 * The provider is resolved here rather than taken from the caller, using the
 * same `sharedPoolProviderForModel` the composer and the limiter use. That is
 * what makes a null answer meaningful: no shared pool serves this selection, so
 * the send draws nothing from the balance and there is no charge to preview — a
 * BYOK key, a custom endpoint, or a free model.
 */
export async function GET(req: NextRequest): Promise<Response> {
  const authResult = await requireAuth()
  if (isAuthError(authResult)) return authResult
  const { userId } = authResult

  const { searchParams } = new URL(req.url)
  const agent = searchParams.get("agent")
  const model = searchParams.get("model")
  const chatId = searchParams.get("chatId")

  if (!agent) return badRequest("Missing agent")
  if (!model) return badRequest("Missing model")

  try {
    // A chat the caller does not own must not narrow the sample — its turn costs
    // would be someone else's usage, read back through this endpoint.
    let scopedChatId: string | null = null
    if (chatId && (await getChatWithAuth(chatId, userId))) scopedChatId = chatId

    const flags = await getEffectiveCredentialFlags(userId)
    // An agent id this build does not know resolves to no pool, which is the
    // same answer as a BYOK key: nothing to preview.
    const provider = sharedPoolProviderForModel(agent as Agent, model, flags.flags)

    const response: CostEstimateResponse = {
      fromUsd: provider
        ? await cached(`${userId}:${scopedChatId ?? "-"}:${provider}:${model}`, () =>
            getCostEstimate({ userId, chatId: scopedChatId, provider, model })
          )
        : null,
    }
    return Response.json(response)
  } catch (error) {
    return internalError(error)
  }
}
