"use client"

import { useMemo } from "react"
import { GitMerge } from "lucide-react"
import { cn } from "@/lib/utils"
import { GitBranchDialog, type GitBranchDialogConfig } from "./GitBranchDialog"
import type { GitDialogProps } from "./types"

export function MergeDialog({ open, onClose, gitDialogs, chat, isMobile = false, onReviewChanges }: GitDialogProps & { onReviewChanges?: () => void }) {
  const config = useMemo<GitBranchDialogConfig>(() => ({
    title: "Merge Branch",
    icon: <GitMerge />,
    sourceLabel: "From chat",
    targetLabel: "Into chat",
    actionLabel: "Merge",
    onAction: gitDialogs.handleMerge,
    additionalContent: (
      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={gitDialogs.squashMerge}
            onChange={(e) => gitDialogs.setSquashMerge(e.target.checked)}
            className="h-4 w-4 rounded border-border accent-primary"
          />
          <span className={cn(
            "text-muted-foreground",
            isMobile ? "text-base" : "text-sm"
          )}>Squash commits</span>
        </label>
        {onReviewChanges && (
          <button
            type="button"
            onClick={() => {
              onClose()
              onReviewChanges()
            }}
            className={cn(
              "underline underline-offset-2 hover:no-underline cursor-pointer",
              isMobile ? "text-base" : "text-sm"
            )}
          >
            Review changes
          </button>
        )}
      </div>
    ),
  }), [gitDialogs.handleMerge, gitDialogs.squashMerge, gitDialogs.setSquashMerge, isMobile, onClose, onReviewChanges])

  return (
    <GitBranchDialog
      open={open}
      onClose={onClose}
      gitDialogs={gitDialogs}
      chat={chat}
      isMobile={isMobile}
      config={config}
    />
  )
}
