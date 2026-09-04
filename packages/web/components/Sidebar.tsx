"use client"

import { useState, useRef, useCallback, useEffect, useMemo } from "react"
import { useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { PanelLeft } from "lucide-react"
import { usePalette } from "@/components/search-palette/PaletteProvider"
import { cn } from "@/lib/utils"
import { useClickOutside } from "@/lib/hooks/useClickOutside"
import { useElectron } from "@/lib/hooks/useElectron"
import { useGitHubUserQuery } from "@/lib/query"
import { useModals, ALL_REPOSITORIES, NO_REPOSITORY, ARCHIVED_CHATS, MIN_WIDTH, MAX_WIDTH, COLLAPSED_WIDTH } from "@/lib/contexts"
import { isChatVisibleForFilter } from "@/lib/chat-tree"
import type { Chat } from "@/lib/types"
import { NEW_REPOSITORY } from "@/lib/types"
import { signInWithGitHub } from "@/lib/auth-utils"
import {
  UserMenu,
  RepoFilterDropdown,
  renderChatTree,
  getChatRepos,
} from "./sidebar"
import { SidebarActions } from "./sidebar/SidebarActions"
import { MobileSidebarDrawer } from "./sidebar/MobileSidebarDrawer"
import { useSidebarResize } from "@/lib/hooks/useSidebarResize"
import { useDragToMerge } from "@/lib/hooks/useDragToMerge"

export { ALL_REPOSITORIES, NO_REPOSITORY, ARCHIVED_CHATS } from "@/lib/contexts"

const DOCS_URL = process.env.NEXT_PUBLIC_DOCS_URL || "https://docs.backgrounder.dev"

interface SidebarProps {
  chats: Chat[]
  currentChatId: string | null
  deletingChatIds: Set<string>
  unseenChatIds?: Set<string>
  onSelectChat: (chatId: string) => void
  onNewChat: () => void
  onDeleteChat: (chatId: string) => void
  onPinChat?: (chatId: string, pinned: boolean) => void
  onBranchChat?: (chatId: string) => void
  onArchiveChat?: (chatId: string) => void
  onUnarchiveChat?: (chatId: string) => void
  onRenameChat: (chatId: string, newName: string) => void
  collapsed: boolean
  onToggleCollapse: () => void
  width: number
  onWidthChange: (width: number) => void
  isMobile?: boolean
  mobileOpen?: boolean
  onMobileClose?: () => void
  repoFilter?: string
  onRepoFilterChange?: (filter: string) => void
  collapsedChatIds?: Set<string>
  onToggleChatCollapsed?: (id: string) => void
  onRequestMergeChats?: (sourceId: string, targetId?: string) => void
  onRequestRebaseChat?: (sourceId: string) => void
  onOpenScheduledJobs?: () => void
  scheduledJobsActive?: boolean
  selectedScheduledJob?: { id: string; name: string } | null
  isLoadingChats?: boolean
}

export function Sidebar({
  chats,
  currentChatId,
  deletingChatIds,
  unseenChatIds,
  onSelectChat,
  onNewChat,
  onDeleteChat,
  onPinChat,
  onBranchChat,
  onArchiveChat,
  onUnarchiveChat,
  onRenameChat,
  collapsed,
  onToggleCollapse,
  width,
  onWidthChange,
  isMobile = false,
  mobileOpen = false,
  onMobileClose,
  repoFilter: controlledRepoFilter,
  onRepoFilterChange,
  collapsedChatIds: controlledCollapsedChatIds,
  onToggleChatCollapsed: controlledToggleChatCollapsed,
  onRequestMergeChats,
  onRequestRebaseChat,
  onOpenScheduledJobs,
  scheduledJobsActive = false,
  selectedScheduledJob,
  isLoadingChats = false,
}: SidebarProps) {
  const modals = useModals()
  const { data: session, status: sessionStatus } = useSession()
  const isSessionLoading = sessionStatus === "loading"
  const { data: currentUserLogin } = useGitHubUserQuery()
  const router = useRouter()
  const { openSearch } = usePalette()
  const { isDesktopApp } = useElectron()
  const [isAnimating, setIsAnimating] = useState(false)
  const sidebarRef = useRef<HTMLDivElement>(null)

  // Repository filter state - supports controlled mode from parent
  const [internalRepoFilter, setInternalRepoFilter] = useState<string>(ALL_REPOSITORIES)
  const repoFilter = controlledRepoFilter ?? internalRepoFilter
  const setRepoFilter = onRepoFilterChange ?? setInternalRepoFilter
  const [repoDropdownOpen, setRepoDropdownOpen] = useState(false)
  const repoDropdownRef = useRef<HTMLDivElement>(null)

  // Get unique repositories from chats
  const uniqueRepos = useMemo(
    () => getChatRepos(chats, currentUserLogin),
    [chats, currentUserLogin]
  )

  // Filter chats by selected repository
  const filteredChats = useMemo(() => {
    return chats
      .filter((chat) => isChatVisibleForFilter(chat, repoFilter))
      .sort((a, b) => {
        if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1
        return (b.lastActiveAt ?? b.createdAt) - (a.lastActiveAt ?? a.createdAt)
      })
  }, [chats, repoFilter])

  const showingArchived = repoFilter === ARCHIVED_CHATS

  // Build tree structure
  const buildTree = (list: Chat[]) => {
    const ids = new Set(list.map((c) => c.id))
    const childrenByParent = new Map<string, Chat[]>()
    for (const chat of list) {
      const parentId = chat.parentChatId && ids.has(chat.parentChatId) ? chat.parentChatId : null
      if (parentId) {
        const arr = childrenByParent.get(parentId) ?? []
        arr.push(chat)
        childrenByParent.set(parentId, arr)
      }
    }
    const roots = list.filter((c) => !(c.parentChatId && ids.has(c.parentChatId)))
    return { childrenByParent, roots }
  }

  const { childrenByParent, roots: rootChats } = useMemo(() => buildTree(filteredChats), [filteredChats])

  // Drag-to-merge
  const { dragSourceId, dragOverId, setDragSourceId, setDragOverId, canDrop } = useDragToMerge(chats)

  // Collapsed chat state
  const [internalCollapsedChatIds, setInternalCollapsedChatIds] = useState<Set<string>>(new Set())
  const collapsedChatIds = controlledCollapsedChatIds ?? internalCollapsedChatIds
  const defaultToggleChatCollapsed = useCallback((id: string) => {
    setInternalCollapsedChatIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }, [])
  const toggleChatCollapsed = controlledToggleChatCollapsed ?? defaultToggleChatCollapsed

  // Count chats per repository
  const repoCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    let total = 0
    let noRepoCount = 0
    let archivedCount = 0
    chats.forEach((chat) => {
      const hasMessages = chat.messages.length > 0 || (chat.messageCount ?? 0) > 0
      if (!hasMessages) return
      if (chat.archived) {
        archivedCount++
        return
      }
      total++
      if (chat.repo === NEW_REPOSITORY) {
        noRepoCount++
      } else {
        counts[chat.repo] = (counts[chat.repo] || 0) + 1
      }
    })
    return { counts, total, noRepoCount, archivedCount }
  }, [chats])

  // Get display name for repository
  const getRepoDisplayName = (repo: string) => {
    if (repo === NEW_REPOSITORY) return "No repository"
    if (repo === ALL_REPOSITORIES) return "Active chats"
    if (repo === ARCHIVED_CHATS) return "Archived chats"
    if (repo === NO_REPOSITORY) return "No repository"
    if (currentUserLogin) {
      const prefix = `${currentUserLogin}/`
      if (repo.toLowerCase().startsWith(prefix.toLowerCase())) {
        return repo.slice(prefix.length)
      }
    }
    return repo
  }

  useClickOutside(repoDropdownRef, () => setRepoDropdownOpen(false), repoDropdownOpen)

  // Animate collapse/expand
  const handleToggleCollapse = useCallback(() => {
    setIsAnimating(true)
    onToggleCollapse()
    const timer = setTimeout(() => setIsAnimating(false), 200)
    return () => clearTimeout(timer)
  }, [onToggleCollapse])

  // Sidebar resize
  const { startResizing } = useSidebarResize({
    isMobile,
    collapsed,
    onToggleCollapse,
    onWidthChange,
  })

  // Close mobile drawer when selecting a chat
  const handleSelectChat = (chatId: string) => {
    onSelectChat(chatId)
    if (isMobile && onMobileClose) {
      onMobileClose()
    }
  }

  // Close mobile drawer when creating new chat
  const handleNewChat = () => {
    onNewChat()
    if (isMobile && onMobileClose) {
      onMobileClose()
    }
  }

  // Mobile drawer
  if (isMobile) {
    return (
      <MobileSidebarDrawer
        chats={chats}
        currentChatId={currentChatId}
        deletingChatIds={deletingChatIds}
        unseenChatIds={unseenChatIds}
        mobileOpen={mobileOpen}
        onMobileClose={onMobileClose!}
        onSelectChat={onSelectChat}
        onNewChat={onNewChat}
        onDeleteChat={onDeleteChat}
        onPinChat={onPinChat}
        onBranchChat={onBranchChat}
        onArchiveChat={onArchiveChat}
        onUnarchiveChat={onUnarchiveChat}
        repoFilter={repoFilter}
        setRepoFilter={setRepoFilter}
        uniqueRepos={uniqueRepos}
        repoCounts={repoCounts}
        getRepoDisplayName={getRepoDisplayName}
        showingArchived={showingArchived}
        collapsedChatIds={collapsedChatIds}
        toggleChatCollapsed={toggleChatCollapsed}
        childrenByParent={childrenByParent}
        rootChats={rootChats}
        isLoadingChats={isLoadingChats}
        scheduledJobsActive={scheduledJobsActive}
        selectedScheduledJob={selectedScheduledJob}
        onOpenScheduledJobs={onOpenScheduledJobs ? () => onOpenScheduledJobs() : () => router.push("/scheduled-jobs")}
        docsUrl={DOCS_URL}
        modals={modals}
      />
    )
  }

  // Desktop sidebar
  return (
    <div
      ref={sidebarRef}
      className={cn(
        "relative flex h-full flex-col bg-background border-r border-sidebar-border hide-mobile",
        isAnimating && "transition-[width] duration-200 ease-in-out"
      )}
      style={{ width: collapsed ? COLLAPSED_WIDTH : width }}
    >
      {/* Header */}
      <div
        className={cn(
          "flex items-center p-3",
          collapsed ? "justify-center" : "justify-between",
          isDesktopApp && collapsed && "mt-[30px]"
        )}
        style={isDesktopApp ? { WebkitAppRegion: "drag" } as React.CSSProperties : undefined}
      >
        {!collapsed && (
          <h1 className={cn(
            "text-sm font-semibold text-foreground truncate",
            isDesktopApp && "invisible"
          )}>
            Background Agents
          </h1>
        )}
        <button
          onClick={handleToggleCollapse}
          className="p-1.5 rounded-md hover:bg-accent text-muted-foreground/70 hover:text-foreground transition-colors cursor-pointer"
          style={isDesktopApp ? { WebkitAppRegion: "no-drag" } as React.CSSProperties : undefined}
        >
          <PanelLeft className="h-4 w-4" />
        </button>
      </div>

      {/* Action Buttons */}
      <SidebarActions
        collapsed={collapsed}
        scheduledJobsActive={scheduledJobsActive}
        selectedScheduledJob={selectedScheduledJob}
        docsUrl={DOCS_URL}
        onNewChat={onNewChat}
        onOpenSearch={openSearch}
        onOpenScheduledJobs={onOpenScheduledJobs ? onOpenScheduledJobs : () => router.push("/scheduled-jobs")}
      />

      <div className="pb-2" />

      {/* Chat List - only show when expanded */}
      {!collapsed && (
        <>
          {/* Repository Filter */}
          <div className="px-2 pb-2 relative" ref={repoDropdownRef}>
            <RepoFilterDropdown
              repoFilter={repoFilter}
              setRepoFilter={setRepoFilter}
              repoDropdownOpen={repoDropdownOpen}
              setRepoDropdownOpen={setRepoDropdownOpen}
              uniqueRepos={uniqueRepos}
              repoCounts={repoCounts}
              getRepoDisplayName={getRepoDisplayName}
              variant="desktop"
            />
          </div>

          {/* Chat List */}
          <div className="flex-1 overflow-y-auto scrollbar-auto-hide p-2 pt-0">
            <div className="space-y-0">
              {isLoadingChats ? (
                <div className="space-y-0 animate-pulse">
                  {[70, 50, 85, 55, 75, 60].map((w, i) => (
                    <div key={i} className="flex items-center gap-2 px-2 py-[5px] rounded-md">
                      <div className="h-5 flex-1 rounded bg-muted" style={{ width: `${w}%` }} />
                    </div>
                  ))}
                </div>
              ) : (
                renderChatTree({
                  roots: rootChats,
                  childrenByParent,
                  collapsedChatIds,
                  currentChatId,
                  deletingChatIds,
                  unseenChatIds,
                  sidebarCollapsed: collapsed,
                  onToggleCollapsed: toggleChatCollapsed,
                  onSelectChat,
                  onDeleteChat,
                  onPin: showingArchived ? undefined : onPinChat,
                  onBranch: showingArchived ? undefined : onBranchChat,
                  onArchive: showingArchived ? undefined : onArchiveChat,
                  onUnarchive: showingArchived ? onUnarchiveChat : undefined,
                  onRenameChat,
                  onMerge: showingArchived || !onRequestMergeChats ? undefined : (id) => onRequestMergeChats(id),
                  onRebase: showingArchived || !onRequestRebaseChat ? undefined : (id) => onRequestRebaseChat(id),
                  dragSourceId: showingArchived ? null : dragSourceId,
                  dragOverId: showingArchived ? null : dragOverId,
                  canDrop: showingArchived ? undefined : canDrop,
                  onDragStartChat: showingArchived ? undefined : (id) => setDragSourceId(id),
                  onDragEndChat: showingArchived ? undefined : () => { setDragSourceId(null); setDragOverId(null) },
                  onDragEnterChat: showingArchived ? undefined : (id) => setDragOverId(id),
                  onDragLeaveChat: showingArchived ? undefined : (id) => setDragOverId((prev) => (prev === id ? null : prev)),
                  onDropChat: showingArchived ? undefined : (id) => {
                    if (onRequestMergeChats && dragSourceId) {
                      onRequestMergeChats(dragSourceId, id)
                    }
                    setDragSourceId(null)
                    setDragOverId(null)
                  },
                })
              )}
            </div>
          </div>
        </>
      )}

      {/* Spacer when collapsed */}
      {collapsed && <div className="flex-1" />}

      {/* Footer - User & Settings */}
      <div className={cn("p-1.5", !collapsed && "border-t border-sidebar-border")}>
        {isSessionLoading ? (
          <div className={cn("flex items-center gap-2 animate-pulse", collapsed ? "justify-center" : "px-2 py-1.5")}>
            <div className="h-8 w-8 rounded-full bg-muted flex-shrink-0" />
            {!collapsed && (
              <div className="flex-1 min-w-0 space-y-1.5">
                <div className="h-3.5 w-20 rounded bg-muted" />
                <div className="h-2.5 w-28 rounded bg-muted" />
              </div>
            )}
          </div>
        ) : session?.user ? (
          <UserMenu
            user={session.user}
            collapsed={collapsed}
          />
        ) : (
          <button
            onClick={() => signInWithGitHub()}
            className={cn(
              "flex items-center justify-center gap-2 w-full rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors cursor-pointer",
              collapsed ? "p-2" : "px-3 py-2"
            )}
          >
            {!collapsed && <span className="text-sm">Sign in with GitHub</span>}
          </button>
        )}
      </div>

      {/* Resize Handle */}
      {!collapsed && (
        <div
          onMouseDown={startResizing}
          className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-muted-foreground/30 active:bg-muted-foreground/50 transition-colors"
        />
      )}
    </div>
  )
}
