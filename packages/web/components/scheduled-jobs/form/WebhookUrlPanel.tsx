"use client"

import { Copy, RefreshCw, Check } from "lucide-react"
import { cn } from "@/lib/utils"

interface WebhookUrlPanelProps {
  incomingToken: string | null
  incomingWebhookUrl: string
  copiedUrl: boolean
  rotating: boolean
  onCopy: () => void
  onRotate: () => void
}

/**
 * Read-only display of the incoming-webhook URL with copy and rotate controls.
 * The token is minted as soon as the trigger is picked, so the URL renders
 * immediately — even before the job is saved. The fallback only shows for the
 * brief moment before the mint effect runs.
 */
export function WebhookUrlPanel({
  incomingToken,
  incomingWebhookUrl,
  copiedUrl,
  rotating,
  onCopy,
  onRotate,
}: WebhookUrlPanelProps) {
  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium">Webhook URL</label>

      {incomingToken ? (
        <>
          <div className="flex items-stretch gap-1">
            <input
              type="text"
              readOnly
              value={incomingWebhookUrl}
              onFocus={(e) => e.currentTarget.select()}
              className="flex-1 min-w-0 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <button
              type="button"
              onClick={onCopy}
              className="inline-flex items-center justify-center rounded-md border border-border bg-background px-2 hover:bg-accent transition-colors cursor-pointer"
              title={copiedUrl ? "Copied" : "Copy URL"}
            >
              {copiedUrl ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              onClick={onRotate}
              disabled={rotating}
              className="inline-flex items-center justify-center rounded-md border border-border bg-background px-2 hover:bg-accent transition-colors cursor-pointer disabled:opacity-50"
              title="Generate a new URL and invalidate the existing one"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", rotating && "animate-spin")} />
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            Anyone with this URL can fire this agent — rotate it if it leaks.
          </p>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          Preparing your webhook URL…
        </p>
      )}
    </div>
  )
}
