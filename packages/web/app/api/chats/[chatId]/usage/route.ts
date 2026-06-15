import { NextRequest } from "next/server"
import {
  requireAuth,
  isAuthError,
  getChatWithAuth,
  notFound,
  internalError,
} from "@/lib/db/api-helpers"
import { sumChatUsageByProvider, countChatMessagesByProvider } from "@/lib/db/token-usage"
import { getProviderBudget, type BudgetUnit } from "@/lib/server/usage-budgets"
import { ALL_AGENTS, agentLabels, agentToProvider, type ProviderName } from "@background-agents/common"

/** Reverse map: SDK provider id → human label (via its agent). */
const PROVIDER_LABELS: Record<string, string> = Object.fromEntries(
  ALL_AGENTS.map((agent) => [agentToProvider[agent], agentLabels[agent]])
)

function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider.charAt(0).toUpperCase() + provider.slice(1)
}

/** Per-provider usage for a single chat, in that provider's budget unit. */
export interface ChatProviderUsageView {
  provider: string
  label: string
  /** Unit `value` is measured in: tokens, USD cost, or messages. */
  unit: BudgetUnit
  /** Amount used, in `unit`. */
  value: number
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
    const providers: ChatProviderUsageView[] = await Promise.all(
      rows.map(async (r) => {
        const unit = getProviderBudget(r.provider as ProviderName)?.unit ?? "tokens"
        const value =
          unit === "cost"
            ? r.costUsd
            : unit === "messages"
              ? await countChatMessagesByProvider(chatId, r.provider)
              : r.totalTokens
        return { provider: r.provider, label: providerLabel(r.provider), unit, value }
      })
    )

    const response: ChatUsageResponse = { providers }
    return Response.json(response)
  } catch (error) {
    return internalError(error)
  }
}
