"use client"

import { Loader2, RefreshCw } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Non-content states a preview panel can be in. `ready` is rendered by the
 * panel itself; everything else is rendered by <PanelState>.
 */
export type PanelStatus = "loading" | "stopped" | "expired" | "error"

const DEFAULT_MESSAGE: Record<Exclude<PanelStatus, "loading">, string> = {
  stopped: "This sandbox is stopped.",
  expired: "This sandbox expired.",
  error: "Failed to load.",
}

export interface PanelStateProps {
  status: PanelStatus
  /** Overrides the default message (and is the error text when status is "error"). */
  message?: string
  /**
   * When provided, renders a centered refresh button above the message.
   * Both the top-bar refresh and the in-panel retry funnel through this.
   */
  onRefresh?: () => void
}

/**
 * Shared presentation for every non-content panel state: a centered spinner
 * (loading) or a centered message with a refresh button above it
 * (stopped / expired / error). Used by all preview panels so the
 * stopped/expired/error experience is identical everywhere.
 */
export function PanelState({ status, message, onRefresh }: PanelStateProps) {
  if (status === "loading") {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {message && <span className="text-xs">{message}</span>}
      </div>
    )
  }

  const destructive = status === "error"
  const text = message ?? DEFAULT_MESSAGE[status]
  // "stopped" boots the sandbox; the others are a plain retry.
  const actionTitle = status === "stopped" ? "Start sandbox" : "Refresh"

  return (
    <div
      className={cn(
        "h-full flex flex-col items-center justify-center gap-3 p-4 text-center text-sm",
        destructive ? "text-destructive" : "text-muted-foreground"
      )}
    >
      {onRefresh && (
        <button
          type="button"
          onClick={onRefresh}
          title={actionTitle}
          aria-label={actionTitle}
          className="flex h-9 w-9 items-center justify-center rounded-md text-foreground hover:bg-accent cursor-pointer"
        >
          <RefreshCw className="h-5 w-5" />
        </button>
      )}
      <div>{text}</div>
    </div>
  )
}
