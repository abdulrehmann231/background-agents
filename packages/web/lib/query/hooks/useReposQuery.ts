"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useSession } from "next-auth/react"
import { useEffect, useRef } from "react"
import { queryKeys } from "../keys"
import { fetchAllRepos, type GitHubRepo } from "@/lib/github"

/**
 * Fetches the list of GitHub repositories for the authenticated user.
 * Uses progressive loading - first page loads quickly, then fetches remaining pages in background.
 * Sorted by recently updated, includes owned, collaborator, and org repos.
 */
export function useReposQuery() {
  const { status } = useSession()
  const queryClient = useQueryClient()
  const isFetchingRef = useRef(false)

  const query = useQuery({
    queryKey: queryKeys.github.repos(),
    queryFn: async (): Promise<GitHubRepo[]> => {
      // If already fetching (e.g., from the effect), return cached data
      const cached = queryClient.getQueryData<GitHubRepo[]>(queryKeys.github.repos())
      if (isFetchingRef.current && cached) {
        return cached
      }

      isFetchingRef.current = true
      try {
        return await fetchAllRepos((repos) => {
          // Update the cache progressively as pages are fetched
          queryClient.setQueryData(queryKeys.github.repos(), repos)
        })
      } finally {
        isFetchingRef.current = false
      }
    },
    enabled: status === "authenticated",
    staleTime: 60 * 1000, // 1 minute
    gcTime: 5 * 60 * 1000, // 5 minutes
  })

  return query
}
