"use client"

import { useState, useEffect, useRef } from "react"
import * as Dialog from "@radix-ui/react-dialog"
import { X, Loader2, Github, AlertCircle, Check } from "lucide-react"
import { cn } from "@/lib/utils"
import { focusChatPrompt } from "@/components/ui/modal-header"
import { useDragToClose } from "@/lib/hooks/useDragToClose"
import { Input } from "@/components/ui/input"

interface MCPIntegrationsModalProps {
  open: boolean
  onClose: () => void
  chatId: string
  /** Callback to save MCP permissions */
  onSave: (mcpPermissions: string[], mcpAllowedRepos: string[]) => Promise<void>
  /** Initial MCP permissions */
  initialMcpPermissions: string[]
  initialMcpAllowedRepos: string[]
  isMobile?: boolean
}

/**
 * Available MCP integrations
 */
const MCP_INTEGRATIONS = [
  {
    id: "github",
    name: "GitHub",
    description: "Search issues, create issues, review PRs, and add comments",
    icon: Github,
    features: [
      "Search and view issues",
      "Create new issues",
      "Review pull requests",
      "Add comments to PRs and issues",
      "Get PR diffs and file changes",
    ],
  },
  // Future integrations can be added here
  // {
  //   id: "sentry",
  //   name: "Sentry",
  //   description: "View errors, stack traces, and debugging information",
  //   icon: AlertCircle,
  //   features: [...],
  // },
] as const

export function MCPIntegrationsModal({
  open,
  onClose,
  chatId,
  onSave,
  initialMcpPermissions,
  initialMcpAllowedRepos,
  isMobile = false,
}: MCPIntegrationsModalProps) {
  const contentRef = useRef<HTMLDivElement>(null)

  // Local state for editing
  const [enabledIntegrations, setEnabledIntegrations] = useState<string[]>([])
  const [allowedRepos, setAllowedRepos] = useState<string>("")
  const [isSaving, setIsSaving] = useState(false)

  // Drag to dismiss (mobile only)
  const { handlers: dragHandlers, dragY, isDragging } = useDragToClose({
    onClose,
    enabled: isMobile,
  })

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setEnabledIntegrations(initialMcpPermissions || [])
      setAllowedRepos((initialMcpAllowedRepos || []).join(", "))
      setIsSaving(false)
    }
  }, [open, initialMcpPermissions, initialMcpAllowedRepos])

  const handleSave = async () => {
    if (isSaving) return
    setIsSaving(true)
    try {
      // Parse allowed repos from comma-separated string
      const repos = allowedRepos
        .split(",")
        .map((r) => r.trim())
        .filter((r) => r.length > 0 && r.includes("/"))

      await onSave(enabledIntegrations, repos)
      onClose()
    } catch (error) {
      console.error("Failed to save MCP integrations:", error)
    } finally {
      setIsSaving(false)
    }
  }

  const toggleIntegration = (id: string) => {
    setEnabledIntegrations((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    )
  }

  const isGitHubEnabled = enabledIntegrations.includes("github")

  const renderContent = () => (
    <div className="space-y-6">
      {/* Info banner */}
      <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg text-sm">
        <AlertCircle className="h-4 w-4 mt-0.5 text-muted-foreground flex-shrink-0" />
        <p className="text-muted-foreground">
          MCP integrations allow the AI agent to interact with external services.
          Enable only the integrations you need for this chat.
        </p>
      </div>

      {/* Integration cards */}
      {MCP_INTEGRATIONS.map((integration) => {
        const Icon = integration.icon
        const isEnabled = enabledIntegrations.includes(integration.id)

        return (
          <div
            key={integration.id}
            className={cn(
              "border rounded-lg p-4 transition-colors",
              isEnabled ? "border-primary bg-primary/5" : "border-border"
            )}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div
                  className={cn(
                    "p-2 rounded-lg",
                    isEnabled ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                  )}
                >
                  <Icon className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-medium">{integration.name}</h3>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {integration.description}
                  </p>
                </div>
              </div>

              {/* Toggle switch */}
              <button
                onClick={() => toggleIntegration(integration.id)}
                className={cn(
                  "relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer flex-shrink-0",
                  isEnabled ? "bg-primary" : "bg-muted"
                )}
                role="switch"
                aria-checked={isEnabled}
              >
                <span
                  className={cn(
                    "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
                    isEnabled ? "translate-x-6" : "translate-x-1"
                  )}
                />
              </button>
            </div>

            {/* Features list */}
            {isEnabled && (
              <div className="mt-4 pt-4 border-t border-border">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                  Capabilities
                </p>
                <ul className="grid grid-cols-1 gap-1.5">
                  {integration.features.map((feature, idx) => (
                    <li key={idx} className="flex items-center gap-2 text-sm">
                      <Check className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                      {feature}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )
      })}

      {/* Repository restrictions (only show when GitHub is enabled) */}
      {isGitHubEnabled && (
        <div className="space-y-2">
          <label className="text-sm font-medium">
            Restrict to specific repositories (optional)
          </label>
          <Input
            type="text"
            value={allowedRepos}
            onChange={(e) => setAllowedRepos(e.target.value)}
            placeholder="owner/repo1, owner/repo2"
            className="font-mono text-sm"
          />
          <p className="text-xs text-muted-foreground">
            Leave empty to allow access to all repositories you have access to.
            Separate multiple repos with commas.
          </p>
        </div>
      )}
    </div>
  )

  return (
    <Dialog.Root open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn(
            "fixed inset-0 z-50 bg-black/15 backdrop-blur-[1px] transition-opacity duration-300",
            open ? "opacity-100" : "opacity-0"
          )}
        />
        <Dialog.Content
          onCloseAutoFocus={(e) => {
            e.preventDefault()
            focusChatPrompt()
          }}
          className={cn(
            "fixed z-50 bg-popover overflow-hidden flex flex-col",
            isMobile
              ? "inset-x-0 bottom-0 top-0 rounded-none"
              : "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-xl h-[560px] max-h-[85vh] border border-border rounded-xl shadow-xl",
            !isDragging && isMobile && "transition-transform duration-300"
          )}
          style={isMobile ? { transform: `translateY(${dragY}px)` } : undefined}
        >
          {isMobile ? (
            <>
              {/* Drag handle */}
              <div className="flex justify-center pt-3 pb-1" {...dragHandlers}>
                <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
              </div>

              {/* Header - also draggable */}
              <div
                className="sticky top-0 flex items-center justify-between border-b border-border bg-popover z-10 px-4 py-3"
                {...dragHandlers}
              >
                <Dialog.Title className="font-semibold text-lg">
                  Integrations
                </Dialog.Title>
                <Dialog.Close className="flex items-center justify-center rounded-lg hover:bg-accent active:bg-accent transition-colors p-2 -mr-2 touch-target cursor-pointer">
                  <X className="h-5 w-5" />
                </Dialog.Close>
              </div>

              {/* Content */}
              <div ref={contentRef} className="flex-1 overflow-y-auto mobile-scroll p-4">
                {renderContent()}
              </div>

              {/* Footer */}
              <div className="sticky bottom-0 flex items-center justify-end gap-3 border-t border-border bg-popover px-4 py-4 pb-safe">
                <button
                  onClick={onClose}
                  disabled={isSaving}
                  className="rounded-md hover:bg-accent active:bg-accent transition-colors touch-target px-6 py-3 text-base cursor-pointer disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={isSaving}
                  className="rounded-md bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80 transition-colors touch-target px-6 py-3 text-base cursor-pointer disabled:opacity-50 flex items-center gap-2"
                >
                  {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                  Save
                </button>
              </div>
            </>
          ) : (
            <div className="flex flex-col flex-1 min-h-0">
              {/* Header with close button and title */}
              <div className="flex items-center justify-between px-5 pt-4 pb-2">
                <Dialog.Title className="text-lg font-semibold">
                  Integrations
                </Dialog.Title>
                <Dialog.Close
                  className="flex items-center justify-center h-7 w-7 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </Dialog.Close>
              </div>

              {/* Content */}
              <div ref={contentRef} className="flex-1 overflow-y-auto px-5 pt-2 pb-4">
                {renderContent()}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-end gap-3 border-t border-border px-5 py-3">
                <button
                  onClick={onClose}
                  disabled={isSaving}
                  className="rounded-md hover:bg-accent transition-colors px-3 py-1.5 text-sm cursor-pointer disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={isSaving}
                  className="rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors px-3 py-1.5 text-sm cursor-pointer disabled:opacity-50 flex items-center gap-2"
                >
                  {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                  Save
                </button>
              </div>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
