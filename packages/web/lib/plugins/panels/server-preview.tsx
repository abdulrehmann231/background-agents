"use client"

import { Globe } from "lucide-react"
import type { PanelPlugin, PanelProps, PreviewItem } from "../types"
import { PanelState } from "./PanelState"
import { useSandboxResource, assertSandboxOk } from "@/lib/hooks/useSandboxResource"

function ServerPreviewComponent({ item, scale = 1, sandboxId, explicitStart, onRefresh }: PanelProps) {
  const url = item.type === "server" ? item.url : ""

  // Probe the sandbox before embedding the iframe, so a stopped/expired sandbox
  // shows the shared PanelState (with a refresh/start button) instead of a
  // broken iframe.
  const { status, error } = useSandboxResource<{ state: string }>({
    sandboxId,
    explicitStart,
    deps: [url],
    load: async ({ autoStart, signal }) => {
      const res = await fetch("/api/sandbox/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sandboxId, autoStart }),
        signal,
      })
      await assertSandboxOk(res)
      return res.json()
    },
  })

  // Only gate on the probe when we have a sandbox to probe; otherwise fall back
  // to rendering the iframe best-effort (preserves prior behavior).
  if (sandboxId) {
    if (status === "loading") return <PanelState status="loading" />
    if (status === "stopped") return <PanelState status="stopped" onRefresh={onRefresh} />
    if (status === "expired") return <PanelState status="expired" onRefresh={onRefresh} />
    if (status === "error") {
      return <PanelState status="error" message={error ?? undefined} onRefresh={onRefresh} />
    }
  }

  // When scale < 1, we expand the iframe and use CSS transform to shrink it
  const iframeStyle: React.CSSProperties = scale < 1
    ? {
        width: `${100 / scale}%`,
        height: `${100 / scale}%`,
        transform: `scale(${scale})`,
        transformOrigin: "top left",
      }
    : {}

  return (
    <div className="h-full w-full overflow-hidden">
      <iframe
        src={url}
        className="border-0 bg-white"
        style={{
          width: "100%",
          height: "100%",
          ...iframeStyle,
        }}
        title="Live preview"
      />
    </div>
  )
}

export const ServerPreviewPlugin: PanelPlugin = {
  id: "server-preview",

  canHandle: (item: PreviewItem) => item.type === "server",

  getLabel: (item: PreviewItem) => {
    if (item.type === "server") {
      return `:${item.port}`
    }
    return "Preview"
  },

  getIcon: () => Globe,

  Component: ServerPreviewComponent,
}
