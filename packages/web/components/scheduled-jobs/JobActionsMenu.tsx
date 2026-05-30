"use client"

import { useState } from "react"
import { MoreHorizontal, Play, Pencil, Trash2 } from "lucide-react"
import type { ScheduledJob } from "@/lib/scheduled-jobs/types"

interface JobActionsMenuProps {
  job: ScheduledJob
  onEdit: (job: ScheduledJob) => void
  onRunNow: (job: ScheduledJob) => void
  onDelete: (job: ScheduledJob) => void
}

/**
 * Per-row "⋯" overflow menu (Edit / Run Now / Delete) shared by the mobile
 * card and desktop table layouts. Manages its own open state and stops click
 * propagation so taps don't also select the row underneath.
 */
export function JobActionsMenu({ job, onEdit, onRunNow, onDelete }: JobActionsMenuProps) {
  const [open, setOpen] = useState(false)

  const handleAction = (e: React.MouseEvent, action: (job: ScheduledJob) => void) => {
    e.stopPropagation()
    setOpen(false)
    action(job)
  }

  return (
    <div className="relative inline-block shrink-0">
      <button
        onClick={(e) => {
          e.stopPropagation()
          setOpen((prev) => !prev)
        }}
        className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={(e) => {
              e.stopPropagation()
              setOpen(false)
            }}
          />
          <div className="absolute right-0 top-full mt-1 z-50 w-36 rounded-md border border-border bg-popover py-1 shadow-lg">
            <button
              onClick={(e) => handleAction(e, onEdit)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent"
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </button>
            <button
              onClick={(e) => handleAction(e, onRunNow)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent"
            >
              <Play className="h-3.5 w-3.5" />
              Run Now
            </button>
            <button
              onClick={(e) => handleAction(e, onDelete)}
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
