"use client"

/**
 * useDraftChat - Draft chat management logic extracted from useChatWithSync
 *
 * Handles creating, updating, and materializing draft chats that exist only
 * locally until the user sends their first message.
 */

import { useState, useCallback, useRef } from "react"
import type { Chat } from "@/lib/types"
import { NEW_REPOSITORY } from "@/lib/types"
import { nanoid } from "nanoid"
import {
  setDraftChatConfig,
  clearDraftChatConfig,
  migrateDraftToRealChat,
  type DraftChatConfig,
} from "@/lib/storage"

interface UseDraftChatOptions {
  initialDraftConfig?: DraftChatConfig
  createChat: (params: {
    repo: string
    baseBranch: string
    parentChatId?: string
    status?: Chat["status"]
  }) => Promise<Chat>
  persistCurrentChatId: (chatId: string | null) => void
}

export function useDraftChat({
  initialDraftConfig,
  createChat,
  persistCurrentChatId,
}: UseDraftChatOptions) {
  const [draftChatConfig, setDraftChatConfigState] = useState<DraftChatConfig | undefined>(initialDraftConfig)
  const materializingDraft = useRef<boolean>(false)

  // Helper to check if a chat ID is a draft
  const isDraftChatId = useCallback((chatId: string | null): boolean => {
    return chatId?.startsWith("draft-") ?? false
  }, [])

  // Enter draft mode - creates a local-only chat that isn't persisted to the database
  const enterDraftMode = useCallback((
    repo: string = NEW_REPOSITORY,
    baseBranch: string = "main",
    agent: string | null = null,
    model: string | null = null,
  ): string => {
    const draftId = `draft-${nanoid()}`
    const config: DraftChatConfig = { id: draftId, repo, baseBranch, agent, model }
    setDraftChatConfigState(config)
    setDraftChatConfig(config)
    persistCurrentChatId(draftId)
    return draftId
  }, [persistCurrentChatId])

  // Update the draft chat config (both React state and localStorage)
  const updateDraftChatConfig = useCallback((updates: Partial<Omit<DraftChatConfig, "id">>) => {
    if (!draftChatConfig) return
    const newConfig: DraftChatConfig = { ...draftChatConfig, ...updates }
    setDraftChatConfigState(newConfig)
    setDraftChatConfig(newConfig)
  }, [draftChatConfig])

  // Materialize a draft chat into a real database chat
  // Returns the full chat object so callers can use it directly without looking it up
  const materializeDraft = useCallback(async (
    draftId: string,
    options?: { status?: Chat["status"] },
    onMigrate?: (draftId: string, newChatId: string) => void
  ): Promise<Chat | null> => {
    if (!draftChatConfig || draftChatConfig.id !== draftId) {
      console.error("Cannot materialize: draft config not found for", draftId)
      return null
    }

    if (materializingDraft.current) {
      // Already materializing, wait for it
      return null
    }

    materializingDraft.current = true
    try {
      const newChat = await createChat({
        repo: draftChatConfig.repo,
        baseBranch: draftChatConfig.baseBranch,
        status: options?.status ?? "pending",
      })

      // Migrate local state from draft ID to real ID
      migrateDraftToRealChat(draftId, newChat.id)

      // Notify caller to migrate their local state
      onMigrate?.(draftId, newChat.id)

      // Clear draft config
      setDraftChatConfigState(undefined)
      clearDraftChatConfig()

      return newChat
    } catch (error) {
      console.error("Failed to materialize draft:", error)
      return null
    } finally {
      materializingDraft.current = false
    }
  }, [draftChatConfig, createChat])

  // Clear draft state (e.g., when navigating away)
  const clearDraft = useCallback(() => {
    setDraftChatConfigState(undefined)
    clearDraftChatConfig()
  }, [])

  // Get a virtual Chat object for the draft (for consistent UI rendering)
  const getDraftChat = useCallback((): Chat | null => {
    if (!draftChatConfig) return null
    const now = Date.now()
    return {
      id: draftChatConfig.id,
      repo: draftChatConfig.repo,
      baseBranch: draftChatConfig.baseBranch,
      branch: null,
      sandboxId: null,
      displayName: null,
      messages: [],
      status: "pending",
      createdAt: now,
      lastActiveAt: now,
      updatedAt: now,
      agent: draftChatConfig.agent ?? undefined,
      model: draftChatConfig.model ?? undefined,
      parentChatId: undefined,
      sessionId: null,
    } as Chat
  }, [draftChatConfig])

  return {
    draftChatConfig,
    isDraftChatId,
    enterDraftMode,
    updateDraftChatConfig,
    materializeDraft,
    clearDraft,
    getDraftChat,
    setDraftChatConfigState,
  }
}
