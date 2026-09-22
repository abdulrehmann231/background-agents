"use client"

import { createContext, useContext, useState, useCallback, ReactNode } from "react"
import { normalizeSectionKey, type SectionKey } from "@/components/settings/sections"
import type { HighlightKey } from "@/components/settings"
import { ROUTES } from "@/lib/hooks/useUrlNavigation"
import { useSidebar } from "./SidebarContext"

// =============================================================================
// ModalContext - Provides modal state to avoid drilling modal callbacks
// =============================================================================

export interface ModalContextValue {
  // Repo Create modal
  repoCreateOpen: boolean
  setRepoCreateOpen: (open: boolean) => void

  // Settings page (a full view, not a modal — see components/settings/SettingsPage)
  settingsOpen: boolean
  settingsHighlightKey: HighlightKey
  /** Section currently shown by the settings page (mirrors /settings/<section>). */
  settingsSection: SectionKey
  /** Set the shown section without touching history (unknown ids fall back to "general"). */
  setSettingsSection: (section: string | null) => void
  /** Called when Settings is left without providing the highlighted API key. */
  settingsDismissRevert: (() => void) | null
  openSettings: (highlightKey?: HighlightKey, onDismissWithoutKey?: () => void) => void
  openSettingsSection: (section?: SectionKey) => void
  /** Clears the one-shot settings state. Navigation away is the caller's job. */
  closeSettings: () => void

  // Help & Sign-in modals
  helpOpen: boolean
  setHelpOpen: (open: boolean) => void
  signInModalOpen: boolean
  setSignInModalOpen: (open: boolean) => void

  // Delete confirmation
  deleteConfirmChatId: string | null
  setDeleteConfirmChatId: (chatId: string | null) => void

  // Environment variables modal
  envVarsModalOpen: boolean
  setEnvVarsModalOpen: (open: boolean) => void

  // MCP servers picker (popover, attached to chat input)
  mcpServersModalOpen: boolean
  setMcpServersModalOpen: (open: boolean) => void

  // Scheduled jobs
  scheduledJobFormOpen: boolean
  setScheduledJobFormOpen: (open: boolean) => void

  // Mobile-specific modals
  mobileCommandsOpen: boolean
  setMobileCommandsOpen: (open: boolean) => void
  mobileTitleMenuOpen: boolean
  setMobileTitleMenuOpen: (open: boolean) => void
  mobileRenameChat: { id: string; name: string } | null
  setMobileRenameChat: (chat: { id: string; name: string } | null) => void

  // Re-auth modal
  reAuthModalOpen: boolean
  setReAuthModalOpen: (open: boolean) => void

  // Per-chat token usage modal (opened from the command palette). Holds the
  // chat id to show usage for; null when closed.
  chatUsageChatId: string | null
  openChatUsage: (chatId: string) => void
  closeChatUsage: () => void
}

interface ModalProviderProps {
  children: ReactNode
  isMobile: boolean
  onMobileSidebarClose?: () => void
}

const ModalContext = createContext<ModalContextValue | null>(null)

export function ModalProvider({ children, isMobile, onMobileSidebarClose }: ModalProviderProps) {
  const sidebar = useSidebar()

  // Repo Create modal
  const [repoCreateOpen, setRepoCreateOpen] = useState(false)

  // Settings page state. "Open" is just the main view being the settings page,
  // so the browser URL (/settings/...) stays the single source of truth.
  const [settingsHighlightKey, setSettingsHighlightKey] = useState<HighlightKey>(null)
  const [settingsSectionState, setSettingsSectionState] = useState<SectionKey>("general")
  // Revert callback invoked if Settings is left without the highlighted key
  // (e.g. the user picked an agent that needs a key, then left without one).
  const [settingsDismissRevert, setSettingsDismissRevert] = useState<(() => void) | null>(null)
  const settingsOpen = sidebar.viewMode === "settings"

  // Help & Sign-in modals
  const [helpOpen, setHelpOpen] = useState(false)
  const [signInModalOpen, setSignInModalOpen] = useState(false)

  // Delete confirmation
  const [deleteConfirmChatId, setDeleteConfirmChatId] = useState<string | null>(null)

  // Environment variables modal
  const [envVarsModalOpen, setEnvVarsModalOpen] = useState(false)

  // MCP servers picker (popover, attached to chat input)
  const [mcpServersModalOpen, setMcpServersModalOpen] = useState(false)

  // Scheduled jobs
  const [scheduledJobFormOpen, setScheduledJobFormOpen] = useState(false)

  // Mobile-specific modals
  const [mobileCommandsOpen, setMobileCommandsOpen] = useState(false)
  const [mobileTitleMenuOpen, setMobileTitleMenuOpen] = useState(false)
  const [mobileRenameChat, setMobileRenameChat] = useState<{ id: string; name: string } | null>(null)

  // Re-auth modal
  const [reAuthModalOpen, setReAuthModalOpen] = useState(false)

  // Per-chat token usage modal
  const [chatUsageChatId, setChatUsageChatId] = useState<string | null>(null)
  const openChatUsage = useCallback((chatId: string) => setChatUsageChatId(chatId), [])
  const closeChatUsage = useCallback(() => setChatUsageChatId(null), [])

  // Show the given section without touching history — used by the URL sync on
  // initial load and browser back/forward.
  const setSettingsSection = useCallback((section: string | null) => {
    setSettingsSectionState(normalizeSectionKey(section))
  }, [])

  // Switch the main view to the settings page at the given section. Uses
  // pushState (like the rest of the app's navigation) so no remount happens,
  // and replaceState when Settings is already open so each visited section
  // doesn't add a history entry to step back through.
  const goToSettings = useCallback((section: SectionKey) => {
    setSettingsSectionState(section)
    const alreadyOpen = sidebar.viewMode === "settings"
    sidebar.setViewMode("settings")
    sidebar.setSelectedScheduledJob(null)
    const url = ROUTES.settings.build(section)
    if (alreadyOpen) window.history.replaceState(null, "", url)
    else window.history.pushState(null, "", url)
    // Close mobile sidebar when opening settings
    if (isMobile) {
      onMobileSidebarClose?.()
    }
  }, [sidebar, isMobile, onMobileSidebarClose])

  // Handler for opening settings (optionally with a highlighted API key field
  // and a revert callback for when it's left without providing that key)
  const openSettings = useCallback((highlightKey?: HighlightKey, onDismissWithoutKey?: () => void) => {
    setSettingsHighlightKey(highlightKey ?? null)
    // Store the callback itself (wrap so useState doesn't treat it as an updater).
    setSettingsDismissRevert(() => onDismissWithoutKey ?? null)
    // A highlighted key only makes sense on the section that shows it.
    goToSettings(highlightKey ? "api-keys" : "general")
  }, [goToSettings])

  // Handler for opening settings to a specific section (used by command palette)
  const openSettingsSection = useCallback((section?: SectionKey) => {
    setSettingsHighlightKey(null)
    setSettingsDismissRevert(null)
    goToSettings(section ?? "general")
  }, [goToSettings])

  // Clear the one-shot settings state (highlight + revert callback). The caller
  // navigates away; the settings page itself persists pending edits first.
  const closeSettings = useCallback(() => {
    setSettingsHighlightKey(null)
    setSettingsDismissRevert(null)
  }, [])

  const value: ModalContextValue = {
    // Repo Create modal
    repoCreateOpen,
    setRepoCreateOpen,

    // Settings page
    settingsOpen,
    settingsHighlightKey,
    settingsSection: settingsSectionState,
    setSettingsSection,
    settingsDismissRevert,
    openSettings,
    openSettingsSection,
    closeSettings,

    // Help & Sign-in modals
    helpOpen,
    setHelpOpen,
    signInModalOpen,
    setSignInModalOpen,

    // Delete confirmation
    deleteConfirmChatId,
    setDeleteConfirmChatId,

    // Environment variables modal
    envVarsModalOpen,
    setEnvVarsModalOpen,

    // MCP servers picker (popover, attached to chat input)
    mcpServersModalOpen,
    setMcpServersModalOpen,

    // Scheduled jobs
    scheduledJobFormOpen,
    setScheduledJobFormOpen,

    // Mobile-specific modals
    mobileCommandsOpen,
    setMobileCommandsOpen,
    mobileTitleMenuOpen,
    setMobileTitleMenuOpen,
    mobileRenameChat,
    setMobileRenameChat,

    // Re-auth modal
    reAuthModalOpen,
    setReAuthModalOpen,

    // Per-chat token usage modal
    chatUsageChatId,
    openChatUsage,
    closeChatUsage,
  }

  return <ModalContext.Provider value={value}>{children}</ModalContext.Provider>
}

export function useModals(): ModalContextValue {
  const context = useContext(ModalContext)
  if (!context) {
    throw new Error("useModals must be used within a ModalProvider")
  }
  return context
}
