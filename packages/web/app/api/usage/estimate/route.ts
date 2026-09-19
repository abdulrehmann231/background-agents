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
 *
 * Not cached here. The aggregate runs in well under a second, and the client
 * asks only when the selection changes or a turn finishes — a cache would buy
 * nothing and would hold a stale figure across exactly the event that makes it
 * stale.
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
      fromUsd: provider ? await getCostEstimate({ chatId: scopedChatId, provider, model }) : null,
    }
    return Response.json(response)
  } catch (error) {
    return internalError(error)
  }
}
