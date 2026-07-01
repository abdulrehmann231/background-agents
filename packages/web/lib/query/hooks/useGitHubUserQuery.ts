"use client"

import { useQuery } from "@tanstack/react-query"
import { useSession } from "next-auth/react"
import { queryKeys } from "../keys"
import { fetchGitHubUserLogin } from "@/lib/github"

/**
 * Fetches the authenticated user's GitHub login (username).
 *
 * Used to shorten repo labels: repositories owned by the current user are
 * shown without their `login/` prefix.
 */
export function useGitHubUserQuery() {
  const { status } = useSession()

  return useQuery({
    queryKey: queryKeys.github.user(),
    queryFn: fetchGitHubUserLogin,
    enabled: status === "authenticated",
    staleTime: 60 * 60 * 1000, // 1 hour — a login rarely changes
    gcTime: 60 * 60 * 1000,
  })
}
