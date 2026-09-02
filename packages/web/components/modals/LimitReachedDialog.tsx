"use client"

import { useCallback, useRef, useEffect } from "react"
import * as Dialog from "@radix-ui/react-dialog"
import { cn } from "@/lib/utils"
import { ModalHeader, focusChatPrompt } from "@/components/ui/modal-header"
import { Crown, Key, Zap } from "lucide-react"
import { AgentIcon } from "@/components/icons/agent-icons"
import { fmtBalance } from "@/lib/format"
import {
  getLimitUpgradeCopy,
  type LimitUpgradeTarget,
} from "@/lib/usage-limit-copy"
import type { Plan } from "@/lib/server/usage-budgets"

interface LimitReachedDialogProps {
  open: boolean
  onClose: () => void
  onContinueWithOpenCode: () => void
  onAddApiKey: () => void
  onUpgradePlan: (targetPlan: LimitUpgradeTarget) => void
  /** Shared-pool provider the blocked run would have used (claude | gemini | opencode). */
  provider?: string
  /** Spent today / the daily balance, in USD of API list value. */
  used?: number | null
  limit?: number | null
  /** Current subscription tier; defaults to Free for older responses. */
  plan?: Plan
  resetAt?: Date
  isMobile?: boolean
}

const PROVIDER_LABEL: Record<string, string> = {
  claude: "Claude",
  gemini: "Gemini",
  opencode: "OpenCode",
}

export function LimitReachedDialog({
  open,
  onClose,
  onContinueWithOpenCode,
  onAddApiKey,
  onUpgradePlan,
  provider,
  used,
  limit,
  plan,
  resetAt,
  isMobile = false,
}: LimitReachedDialogProps) {
  const providerLabel = PROVIDER_LABEL[provider ?? ""] ?? "shared model"
  // Always offer it, even when OpenCode was the pool that ran the user out: the
  // balance is pooled, and this routes to OpenCode's *free* models, which never
  // draw it down and so stay available at zero.
  const canSwitchToOpenCode = true
  const primaryButtonRef = useRef<HTMLButtonElement>(null)
  const upgradeCopy = getLimitUpgradeCopy(plan)

  // Focus the primary button when modal opens
  useEffect(() => {
    if (open) {
      const timer = setTimeout(() => {
        primaryButtonRef.current?.focus()
      }, 0)
      return () => clearTimeout(timer)
    }
  }, [open])

  const handleContinueWithOpenCode = useCallback(() => {
    onContinueWithOpenCode()
    onClose()
  }, [onContinueWithOpenCode, onClose])

  const handleAddApiKey = useCallback(() => {
    onAddApiKey()
    onClose()
  }, [onAddApiKey, onClose])

  const handleUpgradePlan = useCallback(() => {
    if (!upgradeCopy) return
    onUpgradePlan(upgradeCopy.targetPlan)
    onClose()
  }, [upgradeCopy, onUpgradePlan, onClose])

  // Format reset time
  const resetTimeString = resetAt
    ? new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
        timeZoneName: "short",
      }).format(resetAt)
    : "midnight UTC"

  return (
    <Dialog.Root open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn(
            "fixed inset-0 z-50 transition-opacity duration-300 bg-black/15 backdrop-blur-[1px]",
            open ? "opacity-100" : "opacity-0"
          )}
        />
        <Dialog.Content
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            primaryButtonRef.current?.focus()
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault()
            focusChatPrompt()
          }}
          className={cn(
            "fixed z-50 bg-popover overflow-hidden flex flex-col",
            isMobile
              ? "inset-x-4 top-1/2 -translate-y-1/2 rounded-xl"
              : "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md border border-border rounded-xl shadow-xl"
          )}
        >
          <ModalHeader title="Daily Limit Reached" />
          <div className="px-4 pt-3 pb-4 space-y-4">
            <div className="text-sm text-muted-foreground">
              You&apos;ve used your daily balance
              {typeof limit === "number" ? (
                <>
                  {" "}
                  &mdash;{" "}
                  <span className="font-medium text-foreground">
                    {typeof used === "number" ? fmtBalance(used) : fmtBalance(limit)} of{" "}
                    {fmtBalance(limit)}
                  </span>
                </>
              ) : null}
              . It resets at{" "}
              <span className="font-medium text-foreground">{resetTimeString}</span>.
              Your balance is shared across Claude, OpenCode and Gemini.
            </div>

            <div className="space-y-2">
              {/* Primary option: OpenCode's free models, which never draw the balance. */}
              {canSwitchToOpenCode && (
                <button
                  ref={primaryButtonRef}
                  onClick={handleContinueWithOpenCode}
                  className={cn(
                    "w-full flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 hover:bg-primary/10 transition-colors p-3 text-left cursor-pointer",
                    "focus:outline-none focus:ring-2 focus:ring-primary/50"
                  )}
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                    <AgentIcon agent="opencode" className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-foreground">
                      Continue with OpenCode
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Free models - powered by open source
                    </div>
                  </div>
                  <div className="shrink-0 text-xs font-medium text-primary px-2 py-0.5 rounded bg-primary/10">
                    Free
                  </div>
                </button>
              )}

              {/* Option 2: Add API Key for the limited provider */}
              <button
                onClick={handleAddApiKey}
                className={cn(
                  "w-full flex items-center gap-3 rounded-lg border border-border hover:bg-accent/50 transition-colors p-3 text-left cursor-pointer",
                  "focus:outline-none focus:ring-2 focus:ring-ring"
                )}
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                  <Key className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-foreground">
                    Add your {providerLabel} API key
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Use your own {providerLabel} key for unlimited usage
                  </div>
                </div>
              </button>

              {/* Option 3: plan-aware upgrade (hidden for Unlimited). */}
              {upgradeCopy && (
                <button
                  onClick={handleUpgradePlan}
                  className={cn(
                    "w-full flex items-center gap-3 rounded-lg border border-amber-500/30 hover:bg-amber-500/5 transition-colors p-3 text-left cursor-pointer",
                    "focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                  )}
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10">
                    <Crown className="h-5 w-5 text-amber-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-foreground">
                      {upgradeCopy.title}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {upgradeCopy.description}
                    </div>
                  </div>
                  <div className="shrink-0 text-xs font-medium text-amber-600 dark:text-amber-400 px-2 py-0.5 rounded bg-amber-500/10">
                    {upgradeCopy.targetPlan === "pro" ? "Pro" : "Unlimited"}
                  </div>
                </button>
              )}
            </div>

            {/* Dismiss */}
            <div className="flex justify-end pt-1">
              <button
                onClick={onClose}
                className="rounded-md hover:bg-accent transition-colors px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
