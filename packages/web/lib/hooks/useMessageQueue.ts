"use client"

/**
 * useMessageQueue - Queue management logic extracted from useChatWithSync
 *
 * Handles message queuing, pausing, resuming, and dispatching for chats.
 */

import { useState, useCallback, useEffect, useRef } from "react"
import type { Chat, QueuedMessage } from "@/lib/types"
import { setQueuedMessages, setQueuePaused } from "@/lib/storage"
import { useStreamStore } from "@/lib/stores/stream-store"

interface LocalQueueState {
  queuedMessages: Record<string, Chat["queuedMessages"]>
  queuePaused: Record<string, boolean>
}

interface UseMessageQueueOptions {
  currentChat: Chat | null
  chats: Chat[]
  isHydrated: boolean
  initialQueuedMessages?: Record<string, Chat["queuedMessages"]>
  initialQueuePaused?: Record<string, boolean>
  sendMessage: (content: string, agent?: string, model?: string, files?: File[], targetChatId?: string, planMode?: boolean) => Promise<void> | void
}

export function useMessageQueue({
  currentChat,
  chats,
  isHydrated,
  initialQueuedMessages = {},
  initialQueuePaused = {},
  sendMessage,
}: UseMessageQueueOptions) {
  const [localQueueState, setLocalQueueState] = useState<LocalQueueState>({
    queuedMessages: initialQueuedMessages,
    queuePaused: initialQueuePaused,
  })

  const queueDispatchInFlight = useRef<Set<string>>(new Set())
  const sendInFlight = useRef<Set<string>>(new Set())

  // Hydrate initial state
  useEffect(() => {
    if (Object.keys(initialQueuedMessages).length > 0 || Object.keys(initialQueuePaused).length > 0) {
      setLocalQueueState({
        queuedMessages: initialQueuedMessages,
        queuePaused: initialQueuePaused,
      })
    }
  }, [initialQueuedMessages, initialQueuePaused])

  // Dispatch next queued message for a chat
  const dispatchNextQueuedMessage = useCallback((chatId: string, queueOverride?: QueuedMessage[]) => {
    const chat = chats.find((c) => c.id === chatId)
    const queue = queueOverride ?? localQueueState.queuedMessages[chatId]
    if (!chat || !queue || queue.length === 0) return false
    if (localQueueState.queuePaused[chatId]) return false
    if (queueDispatchInFlight.current.has(chatId)) return false
    if (sendInFlight.current.has(chatId)) return false
    if (useStreamStore.getState().isStreaming(chatId)) return false
    if (chat.status !== "ready" || !!chat.backgroundSessionId) return false

    const [first, ...rest] = queue
    queueDispatchInFlight.current.add(chatId)
    setQueuedMessages(chatId, rest.length > 0 ? rest : undefined)
    setLocalQueueState((prev) => ({
      ...prev,
      queuedMessages: { ...prev.queuedMessages, [chatId]: rest.length > 0 ? rest : undefined },
    }))

    void Promise.resolve(sendMessage(first.content, first.agent, first.model, undefined, chatId))
      .finally(() => {
        queueDispatchInFlight.current.delete(chatId)
      })

    return true
  }, [chats, localQueueState.queuedMessages, localQueueState.queuePaused, sendMessage])

  // Add message to queue
  const enqueueMessage = useCallback((content: string, agent?: string, model?: string) => {
    if (!currentChat) return
    const queued: QueuedMessage = { id: `q-${Date.now()}`, content, agent, model }
    const newQueue = [...(currentChat.queuedMessages ?? []), queued]

    setQueuedMessages(currentChat.id, newQueue)
    setQueuePaused(currentChat.id, false)
    setLocalQueueState((prev) => ({
      ...prev,
      queuedMessages: { ...prev.queuedMessages, [currentChat.id]: newQueue },
      queuePaused: { ...prev.queuePaused, [currentChat.id]: false },
    }))
  }, [currentChat])

  // Remove message from queue
  const removeQueuedMessage = useCallback((id: string) => {
    if (!currentChat) return
    const newQueue = (currentChat.queuedMessages ?? []).filter((m) => m.id !== id)
    setQueuedMessages(currentChat.id, newQueue)
    setLocalQueueState((prev) => ({ ...prev, queuedMessages: { ...prev.queuedMessages, [currentChat.id]: newQueue } }))
  }, [currentChat])

  // Resume paused queue
  const resumeQueue = useCallback(() => {
    if (!currentChat?.queuePaused) return
    setQueuePaused(currentChat.id, false)
    setLocalQueueState((prev) => ({ ...prev, queuePaused: { ...prev.queuePaused, [currentChat.id]: false } }))
  }, [currentChat])

  // Auto-drain ready, unpaused queues
  useEffect(() => {
    if (!isHydrated) return

    for (const chat of chats) {
      const queue = localQueueState.queuedMessages[chat.id]
      const paused = localQueueState.queuePaused[chat.id]
      if (!queue || queue.length === 0 || paused) continue
      dispatchNextQueuedMessage(chat.id, queue)
    }
  }, [chats, dispatchNextQueuedMessage, isHydrated, localQueueState.queuedMessages, localQueueState.queuePaused])

  // Merge with chat data for unified access
  const getQueuedMessages = useCallback((chatId: string) => {
    return localQueueState.queuedMessages[chatId]
  }, [localQueueState.queuedMessages])

  const getQueuePaused = useCallback((chatId: string) => {
    return localQueueState.queuePaused[chatId]
  }, [localQueueState.queuePaused])

  return {
    queuedMessages: localQueueState.queuedMessages,
    queuePaused: localQueueState.queuePaused,
    enqueueMessage,
    removeQueuedMessage,
    resumeQueue,
    dispatchNextQueuedMessage,
    getQueuedMessages,
    getQueuePaused,
    // For state updates from parent
    setLocalQueueState,
  }
}
