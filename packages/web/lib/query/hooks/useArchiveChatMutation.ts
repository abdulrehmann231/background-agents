"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "../keys"
import { updateChat as apiUpdateChat } from "@/lib/sync/api"
import type { Chat } from "@/lib/types"

interface ArchiveChatParams {
  chatId: string
  archived: boolean
}

/**
 * Archives or unarchives a chat and all of its descendants.
 *
 * The server PATCH cascades the `archived` flag to the whole branch subtree
 * (see /api/chats/[chatId]), so here we mirror that locally: optimistically
 * flip the flag on the chat and every descendant in the list cache, then
 * reconcile against the server on settle. Modeled on useDeleteChatMutation's
 * descendant collection.
 */
export function useArchiveChatMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ chatId, archived }: ArchiveChatParams) => {
      return apiUpdateChat(chatId, { archived })
    },
    onMutate: async ({ chatId, archived }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.chats.list() })

      const previousChats = queryClient.getQueryData<Chat[]>(queryKeys.chats.list())

      if (previousChats) {
        // Collect the chat + all descendants so a branched subtree archives together.
        const subtreeIds = new Set<string>()
        const collect = (id: string) => {
          subtreeIds.add(id)
          for (const chat of previousChats) {
            if (chat.parentChatId === id) collect(chat.id)
          }
        }
        collect(chatId)

        queryClient.setQueryData<Chat[]>(
          queryKeys.chats.list(),
          previousChats.map((chat) =>
            subtreeIds.has(chat.id) ? { ...chat, archived } : chat
          )
        )
      }

      return { previousChats }
    },
    onError: (err, _params, context) => {
      if (context?.previousChats) {
        queryClient.setQueryData(queryKeys.chats.list(), context.previousChats)
      }
      console.error("Failed to archive chat:", err)
    },
    onSettled: () => {
      // Refetch the list so descendants archived server-side are reflected.
      queryClient.invalidateQueries({ queryKey: queryKeys.chats.list() })
    },
  })
}
