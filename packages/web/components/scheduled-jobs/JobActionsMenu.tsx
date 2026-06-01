"use client"

import { MoreHorizontal, Play, Pencil, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ScheduledJob } from "@/lib/scheduled-jobs/types"

interface JobActionsMenuProps {
  job: ScheduledJob
  /** Whether this job's menu is currently open. */
  isOpen: boolean
  /** Toggle the open state for this job (null closes all). */
  onToggle: (jobId: string | null) => void
  onEdit: (job: ScheduledJob) => void
  onRunNow: (job: ScheduledJob) => void
  onDelete: (job: ScheduledJob) => void
  /** Extra classes for the positioning wrapper (e.g. layout differs by view). */
  className?: string
}

/**
 * The per-job "⋯" overflow menu (Edit / Run Now / Delete). Shared by both the
 * mobile card and the desktop table rows so the two stay in sync.
 */
export function JobActionsMenu({
  job,
  isOpen,
  onToggle,
  onEdit,
  onRunNow,
  onDelete,
  className,
}: JobActionsMenuProps) {
  return (
    <div className={cn("relative", className)}>
      <button
        onClick={(e) => {
          e.stopPropagation()
          onToggle(isOpen ? null : job.id)
        }}
        className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={(e) => {
              e.stopPropagation()
              onToggle(null)
            }}
          />
          <div className="absolute right-0 top-full mt-1 z-50 w-36 rounded-md border border-border bg-popover py-1 shadow-lg">
            <button
              onClick={(e) => {
                e.stopPropagation()
                onEdit(job)
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent"
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                onRunNow(job)
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent"
            >
              <Play className="h-3.5 w-3.5" />
              Run Now
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                onToggle(null)
                onDelete(job)
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-destructive hover:bg-accent"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </button>
          </div>
        </>
      )}
    </div>
  )
}
