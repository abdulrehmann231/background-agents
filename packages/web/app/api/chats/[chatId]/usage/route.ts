import { NextRequest } from "next/server"
import {
  requireAuth,
  isAuthError,
  getChatWithAuth,
  notFound,
  internalError,
} from "@/lib/db/api-helpers"
import { sumChatUsageByProvider } from "@/lib/db/token-usage"
import { ALL_AGENTS, agentLabels, agentToProvider } from "@background-agents/common"

/** Reverse map: SDK provider id → human label (via its agent). */
const PROVIDER_LABELS: Record<string, string> = Object.fromEntries(
  ALL_AGENTS.map((agent) => [agentToProvider[agent], agentLabels[agent]])
)

function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider.charAt(0).toUpperCase() + provider.slice(1)
}

/**
 * Per-provider usage for a single chat: tokens and their API list-price value.
 *
 * Note this is NOT the daily balance. It spans every provider the chat touched,
 * including ones with no shared pool, and it counts own-key runs — which cost
 * the platform nothing. So it answers "what was this conversation worth", not
 * "what did it take off my allowance". The balance lives in the Usage settings
 * tab, which is scoped to the shared pools.
 */
export interface ChatProviderUsageView {
  provider: string
  label: string
  /** Total tokens recorded for this provider in the chat (cache included). */
  totalTokens: number
  /** Those tokens priced at API list rates, in USD. Zero for free models. */
  costUsd: number
}

export interface ChatUsageResponse {
  providers: ChatProviderUsageView[]
}

// =============================================================================
// GET - token usage for a single chat, grouped by provider
// =============================================================================

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ chatId: string }> }
): Promise<Response> {
  const authResult = await requireAuth()
  if (isAuthError(authResult)) return authResult
  const { userId } = authResult
  const { chatId } = await params

  try {
    const chat = await getChatWithAuth(chatId, userId)
    if (!chat) return notFound("Chat not found")

    const rows = await sumChatUsageByProvider(chatId)
    const providers: ChatProviderUsageView[] = rows.map((r) => ({
      provider: r.provider,
      label: providerLabel(r.provider),
      totalTokens: r.totalTokens,
      costUsd: r.costUsd,
    }))

    const response: ChatUsageResponse = { providers }
    return Response.json(response)
  } catch (error) {
    return internalError(error)
  }
}
