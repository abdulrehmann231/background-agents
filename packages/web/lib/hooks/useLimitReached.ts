"use client"

/**
 * useLimitReached - Daily limit handling logic extracted from useChatWithSync
 *
 * Manages the state and actions for when the Claude daily limit is exceeded.
 */

import { useState, useCallback } from "react"
import type { CredentialFlags } from "@/lib/types"
import { getDefaultModelForAgent } from "@/lib/types"

export interface LimitReachedState {
  show: boolean
  pendingMessage?: {
    chatId: string
    content: string
    files?: File[]
    planMode?: boolean
  }
  resetAt?: Date
}

interface UseLimitReachedOptions {
  credentialFlags: CredentialFlags
  onSendMessage: (content: string, agent: string, model: string, files?: File[], chatId?: string, planMode?: boolean) => Promise<void> | void
}

export function useLimitReached({ credentialFlags, onSendMessage }: UseLimitReachedOptions) {
  const [limitReachedState, setLimitReachedState] = useState<LimitReachedState>({ show: false })

  // Dismiss the limit reached dialog
  const dismissLimitReached = useCallback(() => {
    setLimitReachedState({ show: false })
  }, [])

  // Retry the pending message with OpenCode agent
  const retryWithOpenCode = useCallback(() => {
    const pending = limitReachedState.pendingMessage
    if (!pending) return

    // Close the dialog first
    setLimitReachedState({ show: false })

    // Get the default model for OpenCode
    const openCodeModel = getDefaultModelForAgent("opencode", credentialFlags)

    // Send the message with OpenCode agent
    onSendMessage(
      pending.content,
      "opencode",
      openCodeModel,
      pending.files,
      pending.chatId,
      pending.planMode
    )
  }, [limitReachedState.pendingMessage, credentialFlags, onSendMessage])

  // Show the limit reached dialog with pending message info
  const showLimitReached = useCallback((pendingMessage: LimitReachedState["pendingMessage"], resetAt?: Date) => {
    setLimitReachedState({
      show: true,
      pendingMessage,
      resetAt,
    })
  }, [])

  return {
    limitReachedState,
    setLimitReachedState,
    dismissLimitReached,
    retryWithOpenCode,
    showLimitReached,
  }
}
