"use client"

import { useState, useRef, useEffect } from "react"
import { X } from "lucide-react"
import { useSession, signOut } from "next-auth/react"
import { signInWithGitHub } from "@/lib/auth-utils"
import { cn } from "@/lib/utils"
import { useClickOutside } from "@/lib/hooks/useClickOutside"
import { clearAllStorage } from "@/lib/storage"
import type { Chat } from "@/lib/types"
import { SidebarActions } from "./SidebarActions"
import { RepoFilterDropdown } from "./RepoFilterDropdown"
import { renderMobileChatTree } from "./renderMobileChatTree"
import { MobileUserMenu } from "./MobileUserMenu"

interface MobileSidebarDrawerProps {
  chats: Chat[]
  currentChatId: string | null
  deletingChatIds: Set<string>
  unseenChatIds?: Set<string>
  mobileOpen: boolean
  onMobileClose: () => void
  onSelectChat: (chatId: string) => void
  onNewChat: () => void
  onDeleteChat: (chatId: string) => void
  onPinChat?: (chatId: string, pinned: boolean) => void
  onBranchChat?: (chatId: string) => void
  onArchiveChat?: (chatId: string) => void
  onUnarchiveChat?: (chatId: string) => void
  repoFilter: string
  setRepoFilter: (filter: string) => void
  uniqueRepos: string[]
  repoCounts: { counts: Record<string, number>; total: number; noRepoCount: number; archivedCount: number }
  getRepoDisplayName: (repo: string) => string
  showingArchived: boolean
  collapsedChatIds: Set<string>
  toggleChatCollapsed: (id: string) => void
  childrenByParent: Map<string, Chat[]>
  rootChats: Chat[]
  isLoadingChats: boolean
  scheduledJobsActive: boolean
  selectedScheduledJob?: { id: string; name: string } | null
  onOpenScheduledJobs: () => void
  docsUrl: string
  modals: { setMobileRenameChat: (v: { id: string; name: string } | null) => void; openSettings: () => void; setHelpOpen: (v: boolean) => void; setSignInModalOpen: (v: boolean) => void }
}

export function MobileSidebarDrawer({
  chats,
  currentChatId,
  deletingChatIds,
  unseenChatIds,
  mobileOpen,
  onMobileClose,
  onSelectChat,
  onNewChat,
  onDeleteChat,
  onPinChat,
  onBranchChat,
  onArchiveChat,
  onUnarchiveChat,
  repoFilter,
  setRepoFilter,
  uniqueRepos,
  repoCounts,
  getRepoDisplayName,
  showingArchived,
  collapsedChatIds,
  toggleChatCollapsed,
  childrenByParent,
  rootChats,
  isLoadingChats,
  scheduledJobsActive,
  selectedScheduledJob,
  onOpenScheduledJobs,
  docsUrl,
  modals,
}: MobileSidebarDrawerProps) {
  const { data: session, status: sessionStatus } = useSession()
  const isSessionLoading = sessionStatus === "loading"
  const [mobileUserMenuOpen, setMobileUserMenuOpen] = useState(false)
  const mobileUserMenuRef = useRef<HTMLDivElement>(null)
  const [repoDropdownOpen, setRepoDropdownOpen] = useState(false)
  const repoDropdownRef = useRef<HTMLDivElement>(null)

  useClickOutside(repoDropdownRef, () => setRepoDropdownOpen(false), repoDropdownOpen)
  useClickOutside(mobileUserMenuRef, () => setMobileUserMenuOpen(false), mobileUserMenuOpen)

  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = "hidden"
    } else {
      document.body.style.overflow = ""
    }
    return () => {
      document.body.style.overflow = ""
    }
  }, [mobileOpen])

  const handleSelectChat = (chatId: string) => {
    onSelectChat(chatId)
    onMobileClose()
  }

  const handleNewChat = () => {
    onNewChat()
    onMobileClose()
  }

  return (
    <>
      {/* Backdrop overlay */}
      <div
        className={cn(
          "fixed inset-0 z-40 mobile-overlay transition-opacity duration-300",
          mobileOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        )}
        onClick={onMobileClose}
        aria-hidden="true"
      />

      {/* Mobile drawer */}
      <div
        className="fixed inset-y-0 left-0 z-50 w-[280px] flex flex-col bg-background border-r border-sidebar-border transition-transform duration-300 ease-out"
        style={{
          transform: mobileOpen ? "translateX(0)" : "translateX(-100%)",
        }}
      >
        {/* Header with close button */}
        <div className="flex items-center justify-between px-4 pt-safe">
          <h1 className="text-base font-semibold text-foreground">
            Background Agents
          </h1>
          <button
            onClick={onMobileClose}
            className="p-2 -mr-2 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors touch-target"
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Action Buttons */}
        <SidebarActions
          isMobile
          scheduledJobsActive={scheduledJobsActive}
          selectedScheduledJob={selectedScheduledJob}
          docsUrl={docsUrl}
          onNewChat={handleNewChat}
          onOpenSearch={() => {
            // openSearch is called from parent — here we just close
            onMobileClose()
          }}
          onOpenScheduledJobs={onOpenScheduledJobs}
          onMobileClose={onMobileClose}
        />

        {/* Repository Filter */}
        <div className="px-3 pb-2 relative" ref={repoDropdownRef}>
          <RepoFilterDropdown
            repoFilter={repoFilter}
            setRepoFilter={setRepoFilter}
            repoDropdownOpen={repoDropdownOpen}
            setRepoDropdownOpen={setRepoDropdownOpen}
            uniqueRepos={uniqueRepos}
            repoCounts={repoCounts}
            getRepoDisplayName={getRepoDisplayName}
            variant="mobile"
          />
        </div>

        {/* Chat List */}
        <div className="flex-1 overflow-y-auto mobile-scroll scrollbar-auto-hide px-3 py-2">
          <div className="space-y-0.5">
            {isLoadingChats ? (
              <div className="space-y-0.5 animate-pulse">
                {[75, 55, 85, 60, 70].map((width, i) => (
                  <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-md">
                    <div className="h-5 flex-1 rounded bg-muted" style={{ width: `${width}%` }} />
                  </div>
                ))}
              </div>
            ) : (
              renderMobileChatTree({
                roots: rootChats,
                childrenByParent,
                collapsedChatIds,
                currentChatId,
                deletingChatIds,
                unseenChatIds,
                onToggleCollapsed: toggleChatCollapsed,
                onSelectChat: handleSelectChat,
                onDeleteChat,
                onPin: showingArchived ? undefined : onPinChat,
                onBranch: showingArchived ? undefined : onBranchChat,
                onArchive: showingArchived ? undefined : onArchiveChat,
                onUnarchive: showingArchived ? onUnarchiveChat : undefined,
                onRequestRename: (id, name) => modals.setMobileRenameChat({ id, name }),
              })
            )}
          </div>
        </div>

        {/* Footer - User & Settings */}
        <MobileUserMenu
          session={session}
          isSessionLoading={isSessionLoading}
          mobileUserMenuOpen={mobileUserMenuOpen}
          setMobileUserMenuOpen={setMobileUserMenuOpen}
          mobileUserMenuRef={mobileUserMenuRef}
          modals={modals}
        />
      </div>
    </>
  )
}
