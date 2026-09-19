"use client"

import { useQuery } from "@tanstack/react-query"
import { queryKeys } from "../keys"
import type { CostEstimateResponse } from "@/app/api/usage/estimate/route"

/**
 * What the next send starts around, for the selected agent and model.
 *
 * Keyed on the selection rather than on the draft, because the figure does not
 * depend on what is typed: it prices a whole turn's input and cache traffic,
 * which the agent loop dominates. Switching agent or model re-quotes at once;
 * a finished turn invalidates this key from useStreaming, since the chat's own
 * history is what just changed. `staleTime` only stops a remount in between
 * from re-fetching what it already has — an invalidation still refetches.
 */
export function useCostEstimateQuery(
  agent: string | undefined,
  model: string | undefined,
  chatId: string | null
) {
  return useQuery({
    queryKey: queryKeys.costEstimate.for(agent ?? "", model ?? "", chatId),
    queryFn: async (): Promise<CostEstimateResponse> => {
      const params = new URLSearchParams({ agent: agent!, model: model! })
      if (chatId) params.set("chatId", chatId)
      const res = await fetch(`/api/usage/estimate?${params}`)
      if (!res.ok) throw new Error("Failed to load cost estimate")
      return res.json()
    },
    enabled: Boolean(agent && model),
    staleTime: 5 * 60 * 1000,
  })
}
