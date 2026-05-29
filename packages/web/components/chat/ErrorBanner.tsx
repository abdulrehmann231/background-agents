"use client"

import { useState, useRef, useLayoutEffect } from "react"
import { AlertTriangle } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ChatStatus } from "@/lib/types"

interface ErrorBannerProps {
  message: string
  isMobile?: boolean
  /** Optional handler that re-checks chat status from the backend. When the
   *  SSE stream drops we surface an error here even though the agent may
   *  have actually finished — clicking "Refresh" reconciles with the server. */
  onRefresh?: () => Promise<ChatStatus | null> | void
}

type RefreshState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "stillErrored" }

export function ErrorBanner({ message, isMobile, onRefresh }: ErrorBannerProps) {
  const [expanded, setExpanded] = useState(false)
  const [overflow, setOverflow] = useState(false)
  const [refreshState, setRefreshState] = useState<RefreshState>({ kind: "idle" })
  const contentRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const el = contentRef.current
    if (!el) return
    setOverflow(el.scrollHeight > el.clientHeight + 1)
  }, [message, expanded])

  const handleRefresh = async () => {
    if (!onRefresh || refreshState.kind === "checking") return
    setRefreshState({ kind: "checking" })
    try {
      const result = await onRefresh()
      // If the chat is still errored after the re-check, leave the banner up
      // and surface a small "still errored" hint so the click felt actionable.
      // Any other status (ready/running/...) will unmount this banner via the
      // parent's `chat.status === "error"` guard.
      if (result === "error" || result == null) {
        setRefreshState({ kind: "stillErrored" })
      } else {
        setRefreshState({ kind: "idle" })
      }
    } catch {
      setRefreshState({ kind: "stillErrored" })
    }
  }

  return (
    <div
      data-testid="chat-error-banner"
      className={cn(
        // Negative top margin only when there's a preceding sibling, so the
        // banner sits flush against the last message instead of inheriting
        // the messages container's space-y gap.
        "flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 text-destructive",
        isMobile
          ? "[&:not(:first-child)]:-mt-4 px-3 py-2 text-sm"
          : "[&:not(:first-child)]:-mt-6 px-3 py-2 text-[13px]"
      )}
    >
      <AlertTriangle className={cn("shrink-0 mt-0.5", isMobile ? "h-4 w-4" : "h-3.5 w-3.5")} />
      <div className="min-w-0 flex-1">
        <div
          ref={contentRef}
          className={cn(
            "break-words whitespace-pre-wrap",
            !expanded && (isMobile ? "max-h-32 overflow-hidden" : "max-h-24 overflow-hidden")
          )}
        >
          {message}
        </div>
        <div className="mt-1 flex items-center gap-3">
          {(overflow || expanded) && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="underline underline-offset-2 hover:no-underline cursor-pointer"
            >
              {expanded ? "Show less" : "Show more"}
            </button>
          )}
          {onRefresh && (
            <button
              type="button"
              data-testid="chat-error-refresh"
              onClick={handleRefresh}
              disabled={refreshState.kind === "checking"}
              className={cn(
                "underline underline-offset-2 hover:no-underline cursor-pointer disabled:cursor-default disabled:no-underline disabled:opacity-70"
              )}
            >
              {refreshState.kind === "checking" ? "Checking…" : "Refresh"}
            </button>
          )}
          {refreshState.kind === "stillErrored" && (
            <span className="text-destructive/80">Still errored</span>
          )}
        </div>
      </div>
    </div>
  )
}
