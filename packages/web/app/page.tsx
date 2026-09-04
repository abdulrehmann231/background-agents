"use client"

import { useState, useEffect, useCallback } from "react"
import { usePathname } from "next/navigation"
import { useSession } from "next-auth/react"
import { MobileHeader } from "@/components/MobileHeader"
import { Sidebar } from "@/components/Sidebar"
import { ChatPanel } from "@/components/ChatPanel"
import { PreviewView } from "@/components/PreviewView"
import { AppModals } from "@/components/AppModals"
import { AppProviders } from "@/components/AppProviders"
import { useGitDialogs } from "@/components/modals/git-dialogs"
import { ScheduledJobsView } from "@/components/scheduled-jobs/ScheduledJobsView"
import type { SlashCommandType } from "@/components/SlashCommandMenu"
import { usePalette } from "@/components/search-palette"
import { basename } from "@/lib/format"
import { useChatWithSync } from "@/lib/hooks/useChatWithSync"
import { useMobile } from "@/lib/hooks/useMobile"
import { useGitHubTokenCheck } from "@/lib/hooks/useGitHubTokenCheck"
import { usePreview } from "@/lib/hooks/usePreview"
import { usePageTitle } from "@/lib/hooks/usePageTitle"
import { useUrlSync } from "@/lib/hooks/useUrlSync"
import { useSandboxActions } from "@/lib/hooks/useSandboxActions"
import { useDraftChat } from "@/lib/hooks/useDraftChat"
import { usePendingMessageReplay } from "@/lib/hooks/usePendingMessageReplay"
import { usePaletteProps } from "@/lib/hooks/usePaletteProps"
import { useSendMessage } from "@/lib/hooks/useSendMessage"
import { useBranching } from "@/lib/hooks/useBranching"
import { useChatNavigation } from "@/lib/hooks/useChatNavigation"
import { useRepoSelectHandler } from "@/lib/hooks/useRepoSelectHandler"
import { useChatContextValue } from "@/lib/hooks/useChatContextValue"
import { useGitContextValue } from "@/lib/hooks/useGitContextValue"
import { LocalSyncManager } from "@/lib/hooks/useLocalSync"
import {
  ModalProvider,
  useModals,
  GitProvider,
  SidebarProvider,
  useSidebar,
} from "@/lib/contexts"
import { NEW_REPOSITORY, type Message } from "@/lib/types"
import { useReposQuery, useBranchesQuery, useServersQuery } from "@/lib/query"
import type { GitHubRepo, GitHubBranch } from "@/lib/github"
import { hasPendingMessage } from "@/lib/pending-message"

function ChatPanelWithPalette(props: React.ComponentProps<typeof ChatPanel>) {
  const { openCommand } = usePalette()
  return <ChatPanel {...props} onOpenCommandPalette={openCommand} />
}

function MobileHeaderWithPalette(props: React.ComponentProps<typeof MobileHeader>) {
  const { openCommand } = usePalette()
  return <MobileHeader {...props} onOpenCommandPalette={openCommand} />
}

// =============================================================================
// HomePage - Wrapper that sets up providers
// =============================================================================
export default function HomePage() {
  const isMobile = useMobile()

  return (
    <SidebarProvider>
      <HomePageWithSidebar isMobile={isMobile} />
    </SidebarProvider>
  )
}

function HomePageWithSidebar({ isMobile }: { isMobile: boolean }) {
  const sidebar = useSidebar()

  return (
    <ModalProvider
      isMobile={isMobile}
      onMobileSidebarClose={sidebar.closeMobileSidebar}
    >
      <HomePageContent isMobile={isMobile} />
    </ModalProvider>
  )
}

// =============================================================================
// HomePageContent - Main content inside providers
// =============================================================================
interface HomePageContentProps {
  isMobile: boolean
}

function HomePageContent({ isMobile }: HomePageContentProps) {
  const pathname = usePathname()
  const { data: session } = useSession()
  const { githubTokenInvalid, dismissReAuthBanner } = useGitHubTokenCheck()
  const modals = useModals()
  const sidebar = useSidebar()

  const isJobsRoute = pathname?.startsWith("/jobs") ?? false
  const isNewChatRoute = pathname === "/chat/new"
  const urlJobId = sidebar.selectedScheduledJob?.id ?? null

  const {
    chats, currentChat, currentChatId, settings, credentialFlags,
    balanceResetAt, balanceUsed, balanceTotal,
    isHydrated, isLoading, isLoadingMessages, deletingChatIds, unseenChatIds,
    startNewChat, selectChat, removeChat, setChatArchived, setChatPinned,
    renameChat, updateChatRepo, updateCurrentChat, sendMessage, stopAgent,
    updateSettings, addMessage, enqueueMessage, removeQueuedMessage, resumeQueue,
    updateChatById, refetchMessages, reloadChat,
    drafts, updateDraft, clearDraft, draftChatConfig, isDraftChatId,
    updateDraftChatConfig, materializeDraft, setOnConflictStateChange,
    limitReachedState, setLimitReachedState, dismissLimitReached, retryWithOpenCode,
  } = useChatWithSync()

  const [scheduledJobsRefreshKey, setScheduledJobsRefreshKey] = useState(0)
  const [skillsModalOpen, setSkillsModalOpen] = useState(false)

  const {
    isDownloading, githubBranchUrl, envVarsChatEnvVars, envVarsRepoEnvVars,
    handleOpenEnvVars, handleSaveEnvVars, handleDownloadProject,
    handleOpenInGitHub, handleCopyCloneCommand, handleCopyCheckoutCommand, handleOpenInVSCode,
  } = useSandboxActions({
    currentChat, currentChatId, chats, isDraftChatId,
    onOpenEnvVarsModal: () => modals.setEnvVarsModalOpen(true),
  })

  const serversQuery = useServersQuery(currentChat?.sandboxId, currentChat?.previewUrlPattern)
  const availableServers = serversQuery.data ?? []

  const preview = usePreview({ currentChat, updateCurrentChat, availableServers })

  const reposQuery = useReposQuery()
  const repos = reposQuery.data ?? []

  const [currentOwner, currentRepoName] = (currentChat?.repo ?? "").split("/")
  const branchesQuery = useBranchesQuery(
    currentChat?.repo !== NEW_REPOSITORY ? currentOwner : "",
    currentChat?.repo !== NEW_REPOSITORY ? currentRepoName : ""
  )
  const branches = branchesQuery.data ?? []

  const handleAddMessage = useCallback((message: Message) => {
    if (currentChatId) {
      addMessage(currentChatId, message)
    }
  }, [currentChatId, addMessage])

  const gitDialogs = useGitDialogs({
    chat: currentChat ?? null, chats, updateChatById, refetchMessages, setOnConflictStateChange,
  })

  useEffect(() => {
    if (!isMobile) {
      sidebar.setMobileSidebarOpen(false)
    }
  }, [isMobile, sidebar])

  useEffect(() => {
    if (isMobile && isHydrated && !currentChatId && chats.length > 0) {
      const sortedChats = [...chats].sort((a, b) =>
        (b.lastActiveAt ?? b.createdAt) - (a.lastActiveAt ?? a.createdAt)
      )
      const firstChat = sortedChats[0]
      if (firstChat) {
        selectChat(firstChat.id)
      }
    }
  }, [isMobile, isHydrated, currentChatId, chats, selectChat])

  useEffect(() => {
    if (!isHydrated || currentChatId || !session) return
    if (hasPendingMessage()) return
    startNewChat()
  }, [isHydrated, currentChatId, session, startNewChat])

  useUrlSync({
    isHydrated, currentChatId, isDraftChatId, selectChat, startNewChat,
    startAgentDraft: (agent) =>
      startNewChat(NEW_REPOSITORY, "main", undefined, true, "pending", agent),
    setViewMode: sidebar.setViewMode,
    setSelectedScheduledJob: sidebar.setSelectedScheduledJob,
  })

  const {
    displayCurrentChat, isDraftMode, handleUpdateChatProp, currentDraft,
    handleDraftChange, setOptimisticDraft, handleMaterializeDraftForMcp,
  } = useDraftChat({
    isHydrated, currentChat, currentChatId, settings, credentialFlags,
    draftChatConfig, isDraftChatId, updateDraftChatConfig, updateCurrentChat,
    materializeDraft, drafts, updateDraft,
  })

  const {
    handleNewChat, handleSelectChat, handleRepoFilterChange,
    handleOpenScheduledJobs, handleNavigateToJob, handleNavigateChat,
    handleRequestMergeChats, handleRequestRebaseChat, getNextChatId,
  } = useChatNavigation({
    isHydrated, isLoading, session, modals, sidebar, chats, currentChatId,
    displayCurrentChat, repos, isDraftChatId, selectChat, startNewChat, gitDialogs,
  })

  const { errorBanner, handleRepoSelect } = useRepoSelectHandler({
    displayCurrentChat, isDraftMode, updateDraftChatConfig, updateChatRepo,
  })

  const pageTitle = (() => {
    if (isJobsRoute) return sidebar.selectedScheduledJob?.name ?? "Scheduled Agents"
    if (displayCurrentChat?.displayName) return displayCurrentChat.displayName
    if (isNewChatRoute || isDraftMode) return "New Chat"
    return null
  })()

  usePageTitle(pageTitle)

  const { handleSendMessage, isSendingMessage } = useSendMessage({
    sidebar, displayCurrentChat, currentChatId, isDraftMode, sendMessage,
    setOptimisticDraft, openSignInModal: modals.setSignInModalOpen,
  })

  const handleCreateRepo = () => {
    if (!session) {
      modals.setSignInModalOpen(true)
      return
    }
    modals.setRepoCreateOpen(true)
  }

  usePendingMessageReplay({
    isHydrated, chats, currentChatId, startNewChat, sendMessage, updateChatById,
    onReplayBegin: () => modals.setSignInModalOpen(false),
  })

  const {
    canBranch, handleBranchChat, handleBranchFromChat,
    handleBranchWithMessage, handleBranchQueuedMessage,
  } = useBranching({
    currentChat, chats, startNewChat, sendMessage, removeQueuedMessage,
    openSignInModal: modals.setSignInModalOpen,
  })

  const handleSlashCommand = useCallback((command: SlashCommandType) => {
    switch (command) {
      case "merge": gitDialogs.setMergeOpen(true); break
      case "rebase": gitDialogs.setRebaseOpen(true); break
      case "pr": gitDialogs.setPROpen(true); break
      case "squash": gitDialogs.setSquashOpen(true); break
      case "branch": handleBranchChat(); break
      case "abort": gitDialogs.handleAbortConflict(); break
    }
  }, [gitDialogs, handleBranchChat])

  const handlePaletteSelectRepo = useCallback((repo: GitHubRepo) => {
    startNewChat(`${repo.owner.login}/${repo.name}`, repo.default_branch)
  }, [startNewChat])

  const handlePaletteSelectBranch = useCallback((repo: GitHubRepo, branch: GitHubBranch) => {
    startNewChat(`${repo.owner.login}/${repo.name}`, branch.name)
  }, [startNewChat])

  const handleRunCommand = useCallback((command: string) => {
    handleSlashCommand(command as SlashCommandType)
  }, [handleSlashCommand])

  const displayChats = isHydrated ? chats : []
  const displayCurrentChatId = isHydrated ? currentChatId : null

  const previewCommonProps = {
    item: preview.previewItem,
    sandboxId: currentChat?.sandboxId ?? null,
    repo: currentChat?.repo && currentChat.repo !== NEW_REPOSITORY ? currentChat.repo : null,
    branch: currentChat?.branch ?? currentChat?.baseBranch ?? null,
    onClose: preview.closePreview,
    allItems: preview.previewItems,
    onSelectItem: preview.selectPreviewItem,
    onCloseItem: preview.closePreviewItem,
    messages: currentChat?.messages,
  }

  // Context values via dedicated hooks
  const chatContextValue = useChatContextValue({
    displayCurrentChat, displayCurrentChatId, displayChats, settings, credentialFlags,
    isHydrated, isLoadingMessages, isSendingMessage, handleSelectChat, startNewChat,
    removeChat, renameChat, handleUpdateChatProp, updateChatById, handleSendMessage,
    stopAgent, currentChatId, addMessage, enqueueMessage, removeQueuedMessage, resumeQueue,
    drafts, updateDraft, clearDraft, isDraftChatId, draftChatConfig, updateDraftChatConfig,
    refetchMessages, deletingChatIds, unseenChatIds, updateChatRepo,
  })

  const gitContextValue = useGitContextValue({
    gitDialogs, canBranch, handleBranchChat, handleBranchWithMessage, handleBranchQueuedMessage,
  })

  const paletteProps = usePaletteProps({
    isMobile, repos, branches, displayChats, displayCurrentChatId, currentChat,
    availableServers, canBranch, githubBranchUrl, isDownloading,
    handleOpenInGitHub, handleOpenInVSCode, handleDownloadProject,
    handleCopyCloneCommand, handleCopyCheckoutCommand, handleOpenEnvVars,
    handleArchiveChat: (chatId) => setChatArchived(chatId, true, getNextChatId),
    handlePaletteSelectRepo, handlePaletteSelectBranch, handleRepoFilterChange,
    handleRunCommand, handleNewChat, handleBranchChat, handleCreateRepo,
    handleNavigateChat, handleSelectChat, modals, sidebar, preview,
    onToggleSkillsModal: () => setSkillsModalOpen((prev) => !prev),
  })

  return (
    <AppProviders paletteProps={paletteProps} chatContextValue={chatContextValue} gitContextValue={gitContextValue}>
      <LocalSyncManager />
      <div className={`flex overflow-hidden ${isMobile ? 'h-screen-mobile' : 'h-screen'}`}>
        <Sidebar
          chats={displayChats}
          currentChatId={displayCurrentChatId}
          deletingChatIds={deletingChatIds}
          unseenChatIds={unseenChatIds}
          onSelectChat={handleSelectChat}
          onNewChat={handleNewChat}
          onDeleteChat={(chatId) => {
            modals.setDeleteConfirmChatId(chatId)
          }}
          onPinChat={(chatId, pinned) => setChatPinned(chatId, pinned)}
          onBranchChat={handleBranchFromChat}
          onArchiveChat={(chatId) => setChatArchived(chatId, true, getNextChatId)}
          onUnarchiveChat={(chatId) => setChatArchived(chatId, false, getNextChatId)}
          onRenameChat={renameChat}
          isMobile={isMobile}
          collapsed={isMobile ? false : sidebar.collapsed}
          onToggleCollapse={isMobile ? () => {} : () => sidebar.toggleCollapse()}
          width={isMobile ? 280 : sidebar.width}
          onWidthChange={isMobile ? () => {} : sidebar.setWidth}
          mobileOpen={isMobile ? sidebar.mobileSidebarOpen : undefined}
          onMobileClose={isMobile ? () => sidebar.setMobileSidebarOpen(false) : undefined}
          repoFilter={sidebar.repoFilter}
          onRepoFilterChange={handleRepoFilterChange}
          collapsedChatIds={sidebar.collapsedChatIds}
          onToggleChatCollapsed={sidebar.toggleChatCollapsed}
          onRequestMergeChats={handleRequestMergeChats}
          onRequestRebaseChat={handleRequestRebaseChat}
          onOpenScheduledJobs={
            isMobile
              ? () => {
                  handleOpenScheduledJobs()
                  sidebar.setMobileSidebarOpen(false)
                }
              : handleOpenScheduledJobs
          }
          scheduledJobsActive={sidebar.viewMode === "scheduled-jobs"}
          selectedScheduledJob={sidebar.viewMode === "scheduled-jobs" ? sidebar.selectedScheduledJob : null}
          isLoadingChats={!isHydrated || (isLoading && displayChats.length === 0)}
        />

        <div className="flex-1 flex flex-col min-w-0">
          {isMobile && (
            <MobileHeaderWithPalette
              chat={displayCurrentChat}
              viewMode={sidebar.viewMode}
              githubBranchUrl={githubBranchUrl}
              onOpenMenu={() => sidebar.setMobileSidebarOpen(true)}
              onOpenInGitHub={handleOpenInGitHub}
              onOpenEnvVars={handleOpenEnvVars}
            />
          )}

          <div className="flex-1 flex min-h-0">
            <div className="flex-1 flex flex-col min-w-0">
              {sidebar.viewMode === "scheduled-jobs" ? (
                <ScheduledJobsView
                  onOpenForm={() => modals.setScheduledJobFormOpen(true)}
                  refreshKey={scheduledJobsRefreshKey}
                  urlJobId={urlJobId}
                  onNavigateToJob={handleNavigateToJob}
                />
              ) : (
                <ChatPanelWithPalette
                  chat={displayCurrentChat}
                  settings={settings}
                  credentialFlags={credentialFlags}
                  showClaudeLimitDialog={() => {
                    setLimitReachedState({
                      show: true, provider: "claude",
                      used: balanceUsed, limit: balanceTotal,
                      resetAt: balanceResetAt ? new Date(balanceResetAt) : undefined,
                    })
                  }}
                  onSendMessage={handleSendMessage}
                  onReload={reloadChat}
                  onEnqueueMessage={enqueueMessage}
                  onRemoveQueuedMessage={removeQueuedMessage}
                  onResumeQueue={resumeQueue}
                  onStopAgent={stopAgent}
                  onUpdateChat={handleUpdateChatProp}
                  onSlashCommand={handleSlashCommand}
                  onOpenFile={(filePath) => {
                    const filename = basename(filePath)
                    preview.openPreview({ type: "file", filePath, filename })
                  }}
                  onOpenEnvVars={handleOpenEnvVars}
                  isDraftChat={!!displayCurrentChatId && isDraftChatId(displayCurrentChatId)}
                  onMaterializeDraftForMcp={handleMaterializeDraftForMcp}
                  isMobile={isMobile}
                  isLoadingMessages={isLoadingMessages}
                  draft={currentDraft}
                  onDraftChange={handleDraftChange}
                  isSending={isSendingMessage}
                  isAuthenticated={!!session}
                />
              )}
            </div>
            {!isMobile && preview.previewOpen && (
              <>
                <div
                  onMouseDown={preview.startPreviewResize}
                  className="group flex-shrink-0 w-1 cursor-col-resize relative"
                  aria-label="Resize preview"
                  role="separator"
                >
                  <span className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-border/60 group-hover:bg-border group-active:bg-primary transition-colors" />
                </div>
                <PreviewView
                  style={{ width: preview.previewWidth }}
                  className="flex-shrink-0"
                  {...previewCommonProps}
                />
              </>
            )}
          </div>
        </div>

        {isMobile && preview.previewOpen && (
          <div className="fixed inset-0 z-50 flex flex-col bg-card pt-safe">
            <PreviewView className="flex-1 min-h-0" {...previewCommonProps} />
          </div>
        )}

        {preview.isResizingPreview && (
          <div className="fixed inset-0 z-[999] cursor-col-resize" />
        )}

        {errorBanner && (
          <div
            role="alert"
            className="fixed top-4 right-4 z-[1000] max-w-md bg-destructive text-destructive-foreground px-4 py-3 rounded-md shadow-lg text-sm animate-in fade-in slide-in-from-top-2 duration-200"
          >
            {errorBanner}
          </div>
        )}

        <AppModals
          isMobile={isMobile}
          githubTokenInvalid={githubTokenInvalid}
          onDismissReAuthBanner={dismissReAuthBanner}
          onRepoSelect={handleRepoSelect}
          onSaveSettings={updateSettings}
          onSaveEnvVars={handleSaveEnvVars}
          envVarsChatEnvVars={envVarsChatEnvVars}
          envVarsRepoEnvVars={envVarsRepoEnvVars}
          skillsModalOpen={skillsModalOpen}
          onSkillsModalOpenChange={setSkillsModalOpen}
          onScheduledJobSuccess={() => setScheduledJobsRefreshKey((k) => k + 1)}
          onSlashCommand={handleSlashCommand}
          onDeleteChat={(chatId) => removeChat(chatId, getNextChatId)}
          limitReachedState={limitReachedState}
          onDismissLimitReached={dismissLimitReached}
          onContinueWithOpenCode={retryWithOpenCode}
        />
      </div>
    </AppProviders>
  )
}
