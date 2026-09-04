"use client"

import { useState, useCallback, useMemo } from "react"
import type { Chat } from "@/lib/types"
import { NEW_REPOSITORY } from "@/lib/types"

export function useDragToMerge(chats: Chat[]) {
  const [dragSourceId, setDragSourceId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)

  const chatById = useMemo(() => {
    const m = new Map<string, Chat>()
    for (const c of chats) m.set(c.id, c)
    return m
  }, [chats])

  const canDrop = useCallback((sourceId: string | null, targetId: string): boolean => {
    if (!sourceId || sourceId === targetId) return false
    const source = chatById.get(sourceId)
    const target = chatById.get(targetId)
    if (!source || !target) return false
    if (!source.branch || !target.branch) return false
    if (source.repo === NEW_REPOSITORY || source.repo !== target.repo) return false
    return true
  }, [chatById])

  return {
    dragSourceId,
    dragOverId,
    setDragSourceId,
    setDragOverId,
    canDrop,
  }
}
