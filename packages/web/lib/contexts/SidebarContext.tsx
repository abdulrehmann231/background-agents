"use client"

import { createContext, useContext, useState, useCallback, ReactNode } from "react"

// =============================================================================
// SidebarContext - Provides sidebar UI state to avoid prop drilling
// =============================================================================

/** Which primary view fills the main content area. */
export type ViewMode = "chat" | "scheduled-jobs" | "settings"

export interface SidebarContextValue {
  // Sidebar collapse state
  collapsed: boolean
  setCollapsed: (collapsed: boolean) => void
  toggleCollapse: () => void

  // Sidebar width
  width: number
  setWidth: (width: number) => void

  // Mobile sidebar state
  mobileSidebarOpen: boolean
  setMobileSidebarOpen: (open: boolean) => void
  closeMobileSidebar: () => void

  // Repository filter
  repoFilter: string
  setRepoFilter: (filter: string) => void

  // Chat tree collapse state
  collapsedChatIds: Set<string>
  toggleChatCollapsed: (id: string) => void
  expandChatAndAncestors: (targetId: string, byId: Map<string, { parentChatId?: string | null }>) => void

  // Main view (chat, scheduled jobs, or the settings page)
  viewMode: ViewMode
  setViewMode: (mode: ViewMode) => void
  selectedScheduledJob: { id: string; name: string } | null
  setSelectedScheduledJob: (job: { id: string; name: string } | null) => void
}

interface SidebarProviderProps {
  children: ReactNode
}

const SidebarContext = createContext<SidebarContextValue | null>(null)

// Constants for sidebar - exported for use by components
export const ALL_REPOSITORIES = "__all__"
export const NO_REPOSITORY = "__none__"
export const ARCHIVED_CHATS = "__archived__"
export const MIN_WIDTH = 140
export const MAX_WIDTH = 400
export const COLLAPSED_WIDTH = 64
export const COLLAPSE_THRESHOLD = 100

export function SidebarProvider({ children }: SidebarProviderProps) {
  // Sidebar collapse state
  const [collapsed, setCollapsed] = useState(false)
  const toggleCollapse = useCallback(() => setCollapsed((c) => !c), [])

  // Sidebar width
  const [width, setWidth] = useState(260)

  // Mobile sidebar state
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const closeMobileSidebar = useCallback(() => setMobileSidebarOpen(false), [])

  // Repository filter
  const [repoFilter, setRepoFilter] = useState<string>(ALL_REPOSITORIES)

  // Chat tree collapse state
  const [collapsedChatIds, setCollapsedChatIds] = useState<Set<string>>(new Set())

  const toggleChatCollapsed = useCallback((id: string) => {
    setCollapsedChatIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const expandChatAndAncestors = useCallback((targetId: string, byId: Map<string, { parentChatId?: string | null }>) => {
    setCollapsedChatIds((prev) => {
      let next = prev
      let cur = byId.get(targetId)?.parentChatId
      while (cur) {
        if (next.has(cur)) {
          if (next === prev) next = new Set(prev)
          next.delete(cur)
        }
        cur = byId.get(cur)?.parentChatId
      }
      return next
    })
  }, [])

  // View mode (chat vs scheduled jobs vs settings)
  const [viewMode, setViewMode] = useState<ViewMode>("chat")
  const [selectedScheduledJob, setSelectedScheduledJob] = useState<{ id: string; name: string } | null>(null)

  const value: SidebarContextValue = {
    collapsed,
    setCollapsed,
    toggleCollapse,
    width,
    setWidth,
    mobileSidebarOpen,
    setMobileSidebarOpen,
    closeMobileSidebar,
    repoFilter,
    setRepoFilter,
    collapsedChatIds,
    toggleChatCollapsed,
    expandChatAndAncestors,
    viewMode,
    setViewMode,
    selectedScheduledJob,
    setSelectedScheduledJob,
  }

  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>
}

export function useSidebar(): SidebarContextValue {
  const context = useContext(SidebarContext)
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider")
  }
  return context
}
