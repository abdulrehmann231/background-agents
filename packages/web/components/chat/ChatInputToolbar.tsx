"use client"

import { useRef, useEffect, useMemo, useCallback, useState } from "react"
import { AlertTriangle, ArrowUp, Square, ChevronDown, Github, GitBranch, X, Paperclip, Clock, Brain } from "lucide-react"
import { cn } from "@/lib/utils"
import { useModals, useGit } from "@/lib/contexts"
import type { Chat, Settings, Agent, CredentialFlags, PendingFile } from "@/lib/types"
import { NEW_REPOSITORY, agentModels, getDefaultAgent, getDefaultModelForAgent, hasCredentialsForModel } from "@/lib/types"
import { filterSlashCommandsWithConflict } from "@upstream/common"
import { SlashCommandMenu, type SlashCommandType } from "../SlashCommandMenu"
import { PendingFilesDisplay } from "./PendingFilesDisplay"
import { AgentModelSelector } from "./AgentModelSelector"
import { useFileUpload } from "@/lib/hooks/useFileUpload"

// =============================================================================
// ChatInputToolbar - The main chat input area with all controls
// =============================================================================

interface ChatInputToolbarProps {
  chat: Chat
  settings: Settings
  credentialFlags: CredentialFlags
  showClaudeLimitDialog: () => void
  onSendMessage: (message: string, agent: string, model: string, files?: File[], planMode?: boolean) => void
  onEnqueueMessage?: (message: string, agent?: string, model?: string) => void
  onResumeQueue?: () => void
  onStopAgent: () => void
  onChangeRepo?: () => void
  onChangeBranch?: () => void
  onUpdateChat?: (updates: Partial<Chat>) => void
  onSlashCommand?: (command: SlashCommandType) => void
  isMobile?: boolean
  draft?: string
  onDraftChange?: (draft: string) => void
  isSending?: boolean
  isNewChat?: boolean
}

export function ChatInputToolbar({
  chat,
  settings,
  credentialFlags,
  showClaudeLimitDialog,
  onSendMessage,
  onEnqueueMessage,
  onResumeQueue,
  onStopAgent,
  onChangeRepo,
  onChangeBranch,
  onUpdateChat,
  onSlashCommand,
  isMobile = false,
  draft = "",
  onDraftChange,
  isSending = false,
  isNewChat = false,
}: ChatInputToolbarProps) {
  const modals = useModals()
  const git = useGit()

  // Use draft prop as input value
  const input = draft
  const setInput = useCallback((value: string) => {
    onDraftChange?.(value)
  }, [onDraftChange])

  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Plan mode state
  const [planModeEnabled, setPlanModeEnabled] = useState(false)

  // Slash command menu state
  const [slashMenuOpen, setSlashMenuOpen] = useState(false)
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0)

  // File upload state
  const {
    pendingFiles,
    isDraggingOver,
    fileContents,
    fileError,
    fileInputRef,
    addFiles,
    removeFile,
    clearFiles,
    clearError: clearFileError,
    setPreviewFile,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handlePaste,
    getFileTypeForFile,
    getFilePreviewUrl,
    supportedExtensions,
  } = useFileUpload({ onRequireSignIn: () => modals.setSignInModalOpen(true) })

  // Get current agent/model
  const currentAgent = (chat?.agent ?? settings.defaultAgent ?? getDefaultAgent(credentialFlags)) as Agent
  const currentModel = chat?.model ?? settings.defaultModel ?? getDefaultModelForAgent(currentAgent, credentialFlags)

  // Check if the selected model has required credentials
  const availableModels = agentModels[currentAgent] ?? []
  const selectedModelConfig = availableModels.find(m => m.value === currentModel)
  const hasRequiredCredentials = selectedModelConfig
    ? hasCredentialsForModel(selectedModelConfig, credentialFlags, currentAgent)
    : true

  // Conflict state
  const rebaseConflict = git.rebaseConflict
  const inConflict = !!(rebaseConflict?.inRebase || rebaseConflict?.inMerge)

  // Running/queue state
  const hasQueued = (chat?.queuedMessages?.length ?? 0) > 0
  const isPaused = !!(chat?.queuePaused && hasQueued)
  const isRunning = chat?.status === "running" || (hasQueued && !chat?.queuePaused)
  const isCreating = chat?.status === "creating" || isSending
  const hasContent = input.trim() || pendingFiles.length > 0
  const canQueue = !!onEnqueueMessage && !!input.trim() && pendingFiles.length === 0
  const canSend =
    (hasContent && !isRunning && !isCreating && !isPaused) ||
    (isRunning && canQueue) ||
    isPaused

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return

    const rafId = requestAnimationFrame(() => {
      const scrollTop = textarea.scrollTop
      textarea.style.height = "auto"
      const maxHeight = isMobile ? 120 : 200
      textarea.style.height = Math.min(textarea.scrollHeight, maxHeight) + "px"
      textarea.scrollTop = scrollTop
    })

    return () => cancelAnimationFrame(rafId)
  }, [input, isMobile])

  // Update slash menu visibility based on input
  const hasLinkedRepo = !!(chat?.repo && chat.repo !== NEW_REPOSITORY)
  useEffect(() => {
    if (input.startsWith("/")) {
      setSlashMenuOpen(true)
    } else {
      setSlashMenuOpen(false)
      setSlashSelectedIndex(0)
    }
  }, [input])

  // Get filtered commands for keyboard navigation
  const filteredCommands = useMemo(() => {
    if (hasLinkedRepo) return filterSlashCommandsWithConflict(input, inConflict)
    const filter = input.startsWith("/") ? input.slice(1).toLowerCase() : input.toLowerCase()
    const repoCmd = { name: "repo", description: "Create repository", icon: "FolderGit2" }
    if (!filter || repoCmd.name.startsWith(filter)) return [repoCmd]
    return []
  }, [input, hasLinkedRepo, inConflict])

  // Handle slash command selection
  const handleSlashCommandSelect = useCallback((command: SlashCommandType) => {
    setSlashMenuOpen(false)
    setSlashSelectedIndex(0)
    setInput("")
    if (command === "repo") {
      onChangeRepo?.()
      return
    }
    if (command === "abort") {
      git.handleAbortConflict?.()
      return
    }
    onSlashCommand?.(command)
  }, [onSlashCommand, onChangeRepo, git, setInput])

  const handleSend = useCallback(() => {
    if (!canSend) return
    if (!hasRequiredCredentials) return

    // If the agent is running, queue the message instead of sending
    if (isRunning && onEnqueueMessage) {
      onEnqueueMessage(input.trim(), currentAgent, currentModel)
      setInput("")
      textareaRef.current?.focus()
      return
    }

    // Paused queue handling
    if (isPaused) {
      if (input.trim() && onEnqueueMessage) {
        onEnqueueMessage(input.trim(), currentAgent, currentModel)
        setInput("")
      } else {
        onResumeQueue?.()
      }
      textareaRef.current?.focus()
      return
    }

    // Normal send
    const files = pendingFiles.length > 0 ? pendingFiles.map(pf => pf.file) : undefined
    onSendMessage(input.trim(), currentAgent, currentModel, files, planModeEnabled || undefined)
    setInput("")
    clearFiles()
    textareaRef.current?.focus()
  }, [canSend, hasRequiredCredentials, isRunning, isPaused, input, currentAgent, currentModel, pendingFiles, planModeEnabled, onEnqueueMessage, onResumeQueue, onSendMessage, setInput, clearFiles])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Handle slash command menu navigation
    if (slashMenuOpen && filteredCommands.length > 0 && onSlashCommand) {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault()
          setSlashSelectedIndex((prev) =>
            prev < filteredCommands.length - 1 ? prev + 1 : 0
          )
          return
        case "ArrowUp":
          e.preventDefault()
          setSlashSelectedIndex((prev) =>
            prev > 0 ? prev - 1 : filteredCommands.length - 1
          )
          return
        case "Enter":
          e.preventDefault()
          if (filteredCommands[slashSelectedIndex]) {
            handleSlashCommandSelect(filteredCommands[slashSelectedIndex].name as SlashCommandType)
          }
          return
        case "Tab":
          e.preventDefault()
          if (filteredCommands[slashSelectedIndex]) {
            handleSlashCommandSelect(filteredCommands[slashSelectedIndex].name as SlashCommandType)
          }
          return
        case "Escape":
          e.preventDefault()
          setSlashMenuOpen(false)
          setSlashSelectedIndex(0)
          setInput("")
          return
      }
    }

    // Shift+Enter to insert newline
    if (e.key === "Enter" && e.shiftKey) {
      return
    }

    // Option/Alt+Enter, Command/Meta+Enter, or Ctrl+Enter to branch and send
    if (e.key === "Enter" && (e.altKey || e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      if (git.canBranch && input.trim()) {
        git.handleBranchWithMessage(input.trim(), currentAgent, currentModel)
        setInput("")
        clearFiles()
        textareaRef.current?.focus()
      }
      return
    }

    // Normal enter to send
    if (e.key === "Enter") {
      e.preventDefault()
      handleSend()
    }
  }, [slashMenuOpen, filteredCommands, onSlashCommand, slashSelectedIndex, handleSlashCommandSelect, setInput, git, input, currentAgent, currentModel, clearFiles, handleSend])

  const isNewRepo = chat.repo === NEW_REPOSITORY
  const canSelectRepo = chat.messages.length === 0 && !chat.sandboxId
  const canCreateRepo = isNewRepo
  const showRepoButton = canSelectRepo || canCreateRepo

  return (
    <div className={cn(
      "w-full mx-auto",
      isMobile ? "max-w-full" : "max-w-[52rem]"
    )}>
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          "relative flex flex-col border shadow-sm bg-card border-border",
          isMobile ? "rounded-xl" : "rounded-2xl",
          "focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20",
          isDraggingOver && "border-primary ring-2 ring-primary/30"
        )}
      >
        {/* Drop zone overlay */}
        {isDraggingOver && (
          <div className="absolute inset-0 bg-primary/5 rounded-2xl flex items-center justify-center z-10 pointer-events-none">
            <div className="text-primary text-sm font-medium">Drop files here</div>
          </div>
        )}

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={supportedExtensions.map(ext => `.${ext}`).join(',') + ',image/*,text/*,application/pdf,application/json'}
          className="hidden"
          onChange={(e) => {
            if (e.target.files) {
              addFiles(e.target.files)
              e.target.value = ""
            }
          }}
        />

        {/* Pending files display */}
        <PendingFilesDisplay
          pendingFiles={pendingFiles}
          fileContents={fileContents}
          getFileTypeForFile={getFileTypeForFile}
          getFilePreviewUrl={getFilePreviewUrl}
          onRemoveFile={removeFile}
          onPreviewFile={setPreviewFile}
          isMobile={isMobile}
        />

        {/* Text input area */}
        <div className={cn(
          "flex items-end gap-2",
          isMobile ? "px-3 py-2" : "px-4 py-3"
        )}>
          {/* Textarea wrapper with slash command menu */}
          <div className="relative flex-1">
            {/* Slash Command Menu */}
            {onSlashCommand && (
              <SlashCommandMenu
                input={input}
                open={slashMenuOpen}
                onSelect={handleSlashCommandSelect}
                onClose={() => {
                  setSlashMenuOpen(false)
                  setSlashSelectedIndex(0)
                }}
                selectedIndex={slashSelectedIndex}
                onSelectedIndexChange={setSlashSelectedIndex}
                hasLinkedRepo={hasLinkedRepo}
                inConflict={inConflict}
                isMobile={isMobile}
              />
            )}

            <textarea
              ref={textareaRef}
              data-chat-prompt
              data-testid="chat-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={
                isCreating
                  ? "Creating sandbox..."
                  : isRunning
                  ? "Agent is working..."
                  : isNewChat
                  ? "Message..."
                  : "Enter prompt or /merge..."
              }
              rows={1}
              className={cn(
                "w-full resize-none bg-transparent text-foreground placeholder:text-muted-foreground/50 focus:outline-none",
                isMobile ? "text-base" : "text-[15px]"
              )}
            />
          </div>

          {/* Button container */}
          <div className={cn(
            "shrink-0 flex items-center justify-center",
            isMobile ? "h-9 w-9" : "h-7 w-7"
          )}>
            {isRunning && canQueue ? (
              <button
                onClick={handleSend}
                title="Queue message (sent after current response)"
                className={cn(
                  "flex items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80 transition-colors",
                  isMobile ? "h-9 w-9" : "h-7 w-7"
                )}
              >
                <ArrowUp className={cn(isMobile ? "h-4 w-4" : "h-3.5 w-3.5")} />
              </button>
            ) : isRunning ? (
              <button
                onClick={onStopAgent}
                className={cn(
                  "flex items-center justify-center rounded-md bg-red-500 text-white hover:bg-red-600 active:bg-red-700 transition-colors",
                  isMobile ? "h-9 w-9" : "h-7 w-7"
                )}
              >
                <Square className={cn(isMobile ? "h-3.5 w-3.5" : "h-3 w-3", "fill-current")} />
              </button>
            ) : canSend ? (
              <button
                onClick={handleSend}
                className={cn(
                  "flex items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80 transition-colors",
                  isMobile ? "h-9 w-9" : "h-7 w-7"
                )}
              >
                <ArrowUp className={cn(isMobile ? "h-4 w-4" : "h-3.5 w-3.5")} />
              </button>
            ) : null}
          </div>
        </div>

        {/* File upload error message */}
        {fileError && (
          <div className={cn(
            "flex items-start gap-2 text-destructive bg-destructive/10 rounded-md",
            isMobile ? "mx-3 mb-2 px-3 py-2 text-sm" : "mx-4 mb-2 px-3 py-2 text-xs"
          )}>
            <AlertTriangle className={cn("shrink-0 mt-0.5", isMobile ? "h-4 w-4" : "h-3.5 w-3.5")} />
            <span className="flex-1">{fileError}</span>
            <button
              onClick={() => clearFileError()}
              className="shrink-0 text-destructive/70 hover:text-destructive transition-colors"
              aria-label="Dismiss error"
            >
              <X className={cn(isMobile ? "h-4 w-4" : "h-3.5 w-3.5")} />
            </button>
          </div>
        )}

        {/* Bottom row with selectors */}
        <div className={cn(
          "@container",
          isMobile ? "flex flex-col gap-1 px-3 py-2" : "flex items-center gap-3 px-4 py-2"
        )}>
          {/* Left side items */}
          <div className={cn("flex items-center gap-2", isMobile ? "w-full @container/row1" : "flex-1")}>
            {/* Attachment button */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                "shrink-0 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer",
                isMobile ? "h-7 w-7" : "h-6 w-6"
              )}
              title="Attach files"
              aria-label="Attach files"
            >
              <Paperclip className={cn(isMobile ? "h-4 w-4" : "h-3.5 w-3.5")} />
            </button>

            {/* Repo display/selector */}
            {showRepoButton ? (
              <div className="flex items-center gap-1">
                {onChangeRepo && (
                  <button
                    onClick={onChangeRepo}
                    className={cn(
                      "flex items-center gap-1 text-muted-foreground hover:text-foreground active:text-foreground transition-colors cursor-pointer",
                      isMobile ? "text-sm py-1 px-2 rounded-md hover:bg-accent/50" : "text-sm"
                    )}
                    title={isNewRepo ? "Select repository" : chat.repo}
                  >
                    <Github className={cn(isMobile ? "h-4 w-4" : "h-3.5 w-3.5")} />
                    <span className={cn(isMobile ? "hidden @[16rem]/row1:inline" : "hidden @[32rem]:inline")}>
                      {isNewRepo ? "Repository" : chat.repo?.split("/").pop()}
                    </span>
                    <ChevronDown className={cn(isMobile ? "h-4 w-4 hidden @[16rem]/row1:block" : "h-3.5 w-3.5")} />
                  </button>
                )}
                {!isNewRepo && onChangeBranch && isNewChat && (
                  <button
                    onClick={onChangeBranch}
                    className={cn(
                      "flex items-center gap-1 text-muted-foreground hover:text-foreground active:text-foreground transition-colors cursor-pointer",
                      isMobile ? "text-sm py-1 px-2 rounded-md hover:bg-accent/50" : "text-sm"
                    )}
                    title={chat.branch || chat.baseBranch}
                  >
                    <GitBranch className={cn(isMobile ? "h-4 w-4" : "h-3.5 w-3.5")} />
                    <span className={cn(isMobile ? "hidden @[16rem]/row1:inline" : "hidden @[32rem]:inline")}>
                      {chat.branch || chat.baseBranch}
                    </span>
                    <ChevronDown className={cn(isMobile ? "h-4 w-4 hidden @[16rem]/row1:block" : "h-3.5 w-3.5")} />
                  </button>
                )}
                {!isNewRepo && onUpdateChat && canSelectRepo && (
                  <button
                    onClick={() => onUpdateChat({ repo: NEW_REPOSITORY, baseBranch: "main" })}
                    className={cn(
                      "rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors cursor-pointer",
                      isMobile ? "p-1.5" : "p-0.5"
                    )}
                    title="Remove repository"
                  >
                    <X className={cn(isMobile ? "h-4 w-4" : "h-3 w-3")} />
                  </button>
                )}
              </div>
            ) : !isNewRepo && (
              <a
                href={`https://github.com/${chat.repo}/tree/${chat.branch}`}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  "flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors",
                  isMobile ? "text-sm" : "text-sm"
                )}
                title={chat.repo}
              >
                <Github className={cn(isMobile ? "h-4 w-4" : "h-3.5 w-3.5")} />
                <span className={cn(isMobile ? "hidden @[16rem]/row1:inline" : "hidden @[32rem]:inline")}>
                  {chat.repo?.split("/").pop()}
                </span>
              </a>
            )}

            {/* Spacer - only on desktop */}
            {!isMobile && <div className="flex-1" />}
          </div>

          {/* Right side items */}
          <div className={cn("flex items-center gap-2", isMobile && "w-full @container/row2")}>
            {/* Schedule button */}
            <button
              onClick={() => modals.setScheduledJobFormOpen(true)}
              className={cn(
                "flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors cursor-pointer rounded-md hover:bg-accent/50",
                isMobile ? "p-2 touch-target" : "p-1"
              )}
              title="Create scheduled job"
            >
              <Clock className={cn(isMobile ? "h-4 w-4" : "h-3.5 w-3.5")} />
            </button>

            {/* Plan mode toggle */}
            <button
              type="button"
              onClick={() => setPlanModeEnabled((v) => !v)}
              className={cn(
                "shrink-0 flex items-center gap-1 rounded-md transition-colors cursor-pointer",
                planModeEnabled
                  ? "bg-primary/15 text-primary hover:bg-primary/20"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent",
                isMobile ? "h-7 px-2 text-sm" : "h-6 px-1.5 text-sm"
              )}
              title={planModeEnabled ? "Plan mode on \u2014 agent will plan before acting" : "Plan mode off"}
              aria-label="Toggle plan mode"
              aria-pressed={planModeEnabled}
            >
              <Brain className={cn(isMobile ? "h-4 w-4" : "h-3.5 w-3.5")} />
              <span className={cn("text-sm", isMobile ? "hidden @[18rem]/row2:inline" : "hidden @[32rem]:inline")}>Plan</span>
            </button>

            {/* Agent and Model selectors */}
            <AgentModelSelector
              chat={chat}
              credentialFlags={credentialFlags}
              currentAgent={currentAgent}
              currentModel={currentModel}
              onUpdateChat={onUpdateChat}
              showClaudeLimitDialog={showClaudeLimitDialog}
              isMobile={isMobile}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
