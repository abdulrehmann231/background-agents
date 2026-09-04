"use client"

import { useMemo } from "react"
import type { GitContextValue } from "@/lib/contexts"
import type { UseGitDialogsResult } from "@/components/modals/git-dialogs"

interface UseGitContextValueOptions {
  gitDialogs: UseGitDialogsResult
  canBranch: boolean
  handleBranchChat: () => void
  handleBranchWithMessage: (message: string, agent: string, model: string) => Promise<void>
  handleBranchQueuedMessage: (id: string, message: string, agent?: string, model?: string) => Promise<void>
}

export function useGitContextValue(opts: UseGitContextValueOptions): GitContextValue {
  return useMemo(() => ({
    ...opts.gitDialogs,
    canBranch: opts.canBranch,
    handleBranchChat: opts.handleBranchChat,
    handleBranchWithMessage: opts.handleBranchWithMessage,
    handleBranchQueuedMessage: opts.handleBranchQueuedMessage,
  }), [opts.gitDialogs, opts.canBranch, opts.handleBranchChat, opts.handleBranchWithMessage, opts.handleBranchQueuedMessage])
}
