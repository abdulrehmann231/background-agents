"use client"

import { useCallback, useMemo } from "react"
import type { ChatContextValue } from "@/lib/contexts"
import type { Chat, Settings, CredentialFlags, Message } from "@/lib/types"

interface UseChatContextValueOptions {
  displayCurrentChat: Chat | null
  displayCurrentChatId: string | null
  displayChats: Chat[]
  settings: Settings
  credentialFlags: CredentialFlags
  isHydrated: boolean
  isLoadingMessages: boolean
  isSendingMessage: boolean
  handleSelectChat: (chatId: string) => void
  startNewChat: ChatContextValue["startNewChat"]
  removeChat: (chatId: string) => Promise<void>
  renameChat: (chatId: string, name: string) => Promise<void>
  handleUpdateChatProp: (updates: Partial<Chat>) => void
  updateChatById: (chatId: string, updates: Partial<Chat>) => Promise<void>
  handleSendMessage: (message: string, agent: string, model: string, files?: File[], planMode?: boolean) => void
  stopAgent: () => void
  currentChatId: string | null
  addMessage: (chatId: string, message: Message) => void
  enqueueMessage: ChatContextValue["enqueueMessage"]
  removeQueuedMessage: ChatContextValue["removeQueuedMessage"]
  resumeQueue: ChatContextValue["resumeQueue"]
  drafts: Record<string, string>
  updateDraft: (chatId: string, draft: string) => void
  clearDraft: (chatId: string) => void
  isDraftChatId: (chatId: string) => boolean
  draftChatConfig: ChatContextValue["draftChatConfig"]
  updateDraftChatConfig: ChatContextValue["updateDraftChatConfig"]
  refetchMessages: (chatId: string) => Promise<void>
  deletingChatIds: Set<string>
  unseenChatIds: Set<string>
  updateChatRepo: (chatId: string, repo: string, branch: string) => void
}

export function useChatContextValue(opts: UseChatContextValueOptions): ChatContextValue {
  const handleAddMessage = useCallback((message: Message) => {
    if (opts.currentChatId) {
      opts.addMessage(opts.currentChatId, message)
    }
  }, [opts.currentChatId, opts.addMessage])

  return useMemo(() => ({
    currentChat: opts.displayCurrentChat,
    currentChatId: opts.displayCurrentChatId,
    chats: opts.displayChats,
    settings: opts.settings,
    credentialFlags: opts.credentialFlags,
    isHydrated: opts.isHydrated,
    isLoadingMessages: opts.isLoadingMessages,
    isSending: opts.isSendingMessage,
    selectChat: opts.handleSelectChat,
    startNewChat: opts.startNewChat,
    removeChat: opts.removeChat,
    renameChat: opts.renameChat,
    updateCurrentChat: opts.handleUpdateChatProp,
    updateChatById: opts.updateChatById,
    sendMessage: opts.handleSendMessage,
    stopAgent: opts.stopAgent,
    addMessage: handleAddMessage,
    enqueueMessage: opts.enqueueMessage,
    removeQueuedMessage: opts.removeQueuedMessage,
    resumeQueue: opts.resumeQueue,
    drafts: opts.drafts,
    updateDraft: opts.updateDraft,
    clearDraft: opts.clearDraft,
    isDraftChatId: opts.isDraftChatId,
    draftChatConfig: opts.draftChatConfig,
    updateDraftChatConfig: opts.updateDraftChatConfig,
    refetchMessages: opts.refetchMessages,
    deletingChatIds: opts.deletingChatIds,
    unseenChatIds: opts.unseenChatIds,
    updateChatRepo: opts.updateChatRepo,
  }), [
    opts.displayCurrentChat, opts.displayCurrentChatId, opts.displayChats, opts.settings, opts.credentialFlags,
    opts.isHydrated, opts.isLoadingMessages, opts.isSendingMessage, opts.handleSelectChat, opts.startNewChat,
    opts.removeChat, opts.renameChat, opts.handleUpdateChatProp, opts.updateChatById, opts.handleSendMessage,
    opts.stopAgent, handleAddMessage, opts.enqueueMessage, opts.removeQueuedMessage, opts.resumeQueue,
    opts.drafts, opts.updateDraft, opts.clearDraft, opts.isDraftChatId, opts.draftChatConfig, opts.updateDraftChatConfig,
    opts.refetchMessages, opts.deletingChatIds, opts.unseenChatIds, opts.updateChatRepo,
  ])
}
