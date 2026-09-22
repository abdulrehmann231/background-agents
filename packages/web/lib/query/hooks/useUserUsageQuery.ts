"use client"

import { useQuery } from "@tanstack/react-query"
import { useSession } from "next-auth/react"
import { queryKeys } from "../keys"
import type { UserUsageResponse } from "@/app/api/user/usage/route"
import type { UsageRange } from "@/lib/db/user-usage"

export type { UsageRange }
export type UserUsageData = UserUsageResponse

async function fetchUserUsage(range: UsageRange, scope: string): Promise<UserUsageData> {
  const res = await fetch(`/api/user/usage?range=${range}&scope=${encodeURIComponent(scope)}`)
  if (!res.ok) throw new Error(`Failed to load usage (${res.status})`)
  return (await res.json()) as UserUsageData
}

/**
 * The signed-in user's own spend and token usage over a window, optionally
 * narrowed to one repo or chat.
 *
 * Disabled when logged out: the endpoint requires auth, and there is nothing
 * meaningful to show an anonymous visitor.
 */
export function useUserUsageQuery(range: UsageRange, scope: string = "account") {
  const { data: session, status } = useSession()
  const isAuthenticated = status === "authenticated" && !!session?.user?.id

  return useQuery({
    queryKey: queryKeys.user.usage(range, scope),
    queryFn: () => fetchUserUsage(range, scope),
    enabled: isAuthenticated,
    // Usage only moves when a turn finishes, and the tab is not a live monitor.
    staleTime: 60 * 1000,
  })
}
