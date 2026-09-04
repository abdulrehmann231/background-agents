"use client"

import { Plus, Clock, Search, BookOpen } from "lucide-react"
import { cn } from "@/lib/utils"

interface SidebarActionsProps {
  collapsed?: boolean
  isMobile?: boolean
  scheduledJobsActive: boolean
  selectedScheduledJob?: { id: string; name: string } | null
  docsUrl: string
  onNewChat: () => void
  onOpenSearch: () => void
  onOpenScheduledJobs: () => void
  onMobileClose?: () => void
}

export function SidebarActions({
  collapsed = false,
  isMobile = false,
  scheduledJobsActive,
  selectedScheduledJob,
  docsUrl,
  onNewChat,
  onOpenSearch,
  onOpenScheduledJobs,
  onMobileClose,
}: SidebarActionsProps) {
  const iconSize = isMobile ? "h-5 w-5" : "h-4 w-4"
  const textSize = isMobile ? "text-base" : "text-sm"
  const padding = isMobile
    ? "px-3 py-3 rounded-lg hover:bg-accent/50 active:bg-accent"
    : collapsed
      ? "p-1.5"
      : "w-full px-2 py-[7px] hover:bg-accent/50"
  const gap = isMobile ? "gap-3" : "gap-2"

  return (
    <div className={cn(collapsed && !isMobile ? "px-0 flex flex-col items-center gap-1.5" : isMobile ? "px-3 py-2 space-y-1" : "px-2")}>
      <button
        onClick={onNewChat}
        className={cn(
          "flex items-center rounded-md transition-colors cursor-pointer",
          gap,
          padding
        )}
      >
        <Plus className={cn(iconSize, "text-muted-foreground")} />
        <span className={cn(textSize, "text-foreground")}>New Chat</span>
      </button>

      <button
        onClick={onOpenSearch}
        className={cn(
          "flex items-center rounded-md transition-colors cursor-pointer",
          gap,
          padding
        )}
      >
        <Search className={cn(iconSize, "text-muted-foreground")} />
        <span className={cn(textSize, "text-foreground")}>Search Chats</span>
      </button>

      <button
        onClick={onOpenScheduledJobs}
        className={cn(
          "flex items-center rounded-md transition-colors cursor-pointer",
          gap,
          padding,
          scheduledJobsActive && !selectedScheduledJob
            ? "bg-accent text-accent-foreground"
            : isMobile
              ? "hover:bg-accent/50 active:bg-accent"
              : "hover:bg-accent/50"
        )}
      >
        <Clock className={cn(
          iconSize,
          scheduledJobsActive && !selectedScheduledJob ? "text-foreground" : "text-muted-foreground"
        )} />
        <span className={cn(textSize, "text-foreground")}>Scheduled Agents</span>
      </button>

      <a
        href={docsUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onMobileClose}
        className={cn(
          "flex items-center rounded-md transition-colors cursor-pointer",
          gap,
          padding
        )}
      >
        <BookOpen className={cn(iconSize, "text-muted-foreground")} />
        <span className={cn(textSize, "text-foreground")}>Docs</span>
      </a>
    </div>
  )
}
