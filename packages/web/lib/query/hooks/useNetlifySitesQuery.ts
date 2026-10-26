"use client"

import { useQuery } from "@tanstack/react-query"
import { queryKeys } from "../keys"

export interface NetlifySiteInfo {
  id: string
  name: string
  url: string
  adminUrl: string
  repo: string
  branch: string
}

/**
 * The user's Netlify sites that are linked to a GitHub repo. Shared by the
 * chat header's deploy button and Settings → Deployments.
 */
export function useNetlifySitesQuery() {
  return useQuery({
    queryKey: queryKeys.netlify.sites(),
    queryFn: async (): Promise<{ connected: boolean; sites: NetlifySiteInfo[] }> => {
      const res = await fetch("/api/netlify/sites")
      if (!res.ok) throw new Error(`Failed to load Netlify sites: ${res.status}`)
      return res.json()
    },
    staleTime: 30 * 1000, // 30 seconds
  })
}
