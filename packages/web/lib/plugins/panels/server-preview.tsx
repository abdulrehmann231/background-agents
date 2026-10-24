"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import { Globe } from "lucide-react"
import type { PanelPlugin, PanelProps, PreviewItem } from "../types"
import { PanelState } from "./PanelState"
import { useSandboxResource, assertSandboxOk } from "@/lib/hooks/useSandboxResource"

/** Body of a successful /api/sandbox/state probe. See that route for the states. */
interface ServerStateResponse {
  state: "ready" | "server-down" | "starting" | "loopback-only" | "no-recipe" | "failed"
  /** Tail of the dev server's launch log, present when state is "failed". */
  log?: string
}

function ServerPreviewComponent({
  item,
  scale = 1,
  sandboxId,
  chatId,
  onSandboxRecreated,
  recreateRef,
  onStatusChange,
  explicitStart,
  onRefresh,
}: PanelProps) {
  const url = item.type === "server" ? item.url : ""
  const port = item.type === "server" ? item.port : null

  // Declared before any early return so the hook order stays fixed.
  const [frameLoaded, setFrameLoaded] = useState(false)
  const [isRecreating, setIsRecreating] = useState(false)
  // Avoids a stale closure in handleRecreate without having to include
  // isRecreating in its deps (which would otherwise redefine it, and thus
  // reassign recreateRef.current, on every start/stop of a recreation).
  const isRecreatingRef = useRef(false)

  // The panel's own probe (below) never recreates a sandbox — /api/sandbox/state
  // only starts/stops an existing one, so a gone sandboxId 410s forever. This is
  // the one path that actually fixes "This sandbox expired.": recreate it on the
  // chat (same path as sending a new agent message), tell the parent about the
  // fresh id and fresh port URL so sandboxId/item.url update, then run the
  // normal refresh so the panel re-probes — and, since it's an explicit refresh
  // with the port set, replays the recorded dev-server command too.
  //
  // Returns the fresh URL for this item's port (or null on failure) so callers
  // outside the panel — PreviewView's "open in new window" button, via
  // `recreateRef` below — can open it directly instead of the stale `item.url`
  // closed over from before the recreation (preview URLs are sandbox-scoped, so
  // they always change on recreate).
  const handleRecreate = useCallback(async (): Promise<string | null> => {
    if (!chatId || isRecreatingRef.current) return null
    isRecreatingRef.current = true
    setIsRecreating(true)
    try {
      const res = await fetch(`/api/chats/${chatId}/sandbox/recreate`, { method: "POST" })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.sandboxId) {
        console.error("Failed to recreate sandbox:", data?.error ?? res.status)
        return null
      }
      const freshUrl =
        port !== null && data.previewUrlPattern
          ? String(data.previewUrlPattern).replace("{port}", String(port))
          : null
      onSandboxRecreated?.(
        data.sandboxId,
        freshUrl && port !== null ? { port, url: freshUrl } : undefined
      )
      onRefresh()
      return freshUrl
    } catch (error) {
      console.error("Failed to recreate sandbox:", error)
      return null
    } finally {
      isRecreatingRef.current = false
      setIsRecreating(false)
    }
  }, [chatId, port, onSandboxRecreated, onRefresh])

  // Expose the recreate action to PreviewView (for "open in new window" on an
  // expired preview) without it having to duplicate this panel's logic.
  useEffect(() => {
    if (recreateRef) recreateRef.current = handleRecreate
    return () => {
      if (recreateRef) recreateRef.current = null
    }
  }, [recreateRef, handleRecreate])

  // Safety net for the overlay below: a server that accepts the connection but
  // never finishes responding would never fire `load`, and the cover would hide
  // the frame forever. Uncover after a while regardless.
  useEffect(() => {
    const timer = setTimeout(() => setFrameLoaded(true), 30_000)
    return () => clearTimeout(timer)
  }, [])

  // Probe the sandbox before embedding the iframe, so a stopped/expired sandbox
  // shows the shared PanelState (with a refresh/start button) instead of a
  // broken iframe. Passing the port extends that to the process: a sandbox can
  // be running with the dev server long dead, which looks identical to the user
  // but is a different fix. On an explicit refresh the route also replays the
  // command recorded for this port, which is what makes yesterday's preview
  // come back without going through the agent.
  const { status, data, error } = useSandboxResource<ServerStateResponse>({
    sandboxId,
    explicitStart,
    deps: [url],
    load: async ({ autoStart, signal }) => {
      const res = await fetch("/api/sandbox/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sandboxId, autoStart, port }),
        signal,
      })
      await assertSandboxOk(res)
      return res.json()
    },
  })

  // Tell PreviewView what this panel's probe currently says, so its
  // "open in new window" button (rendered outside this component) can tell
  // "expired" apart from "ready" without re-probing itself.
  useEffect(() => {
    onStatusChange?.(status)
  }, [status, onStatusChange])

  // Only gate on the probe when we have a sandbox to probe; otherwise fall back
  // to rendering the iframe best-effort (preserves prior behavior).
  if (sandboxId) {
    if (status === "loading") {
      // An explicit refresh may be booting the sandbox and replaying the dev
      // server command, which takes long enough to deserve saying so.
      return (
        <PanelState
          status="loading"
          message={explicitStart ? "Starting dev server…" : undefined}
        />
      )
    }
    if (status === "stopped") return <PanelState status="stopped" onRefresh={onRefresh} />
    if (status === "expired") {
      return (
        <PanelState
          status={isRecreating ? "loading" : "expired"}
          message={isRecreating ? "Recreating sandbox…" : undefined}
          onRefresh={chatId ? handleRecreate : undefined}
        />
      )
    }
    if (status === "error") {
      return <PanelState status="error" message={error ?? undefined} onRefresh={onRefresh} />
    }

    if (data?.state === "server-down") {
      return <PanelState status="server-down" onRefresh={onRefresh} />
    }
    if (data?.state === "loopback-only") {
      return (
        <PanelState
          status="error"
          message={
            `The dev server on port ${port} is listening on 127.0.0.1 only, so the ` +
            `preview proxy can't reach it. Ask the agent to bind all interfaces — ` +
            `for example \`--host 0.0.0.0\` for Vite, or \`-H 0.0.0.0\` for Next.`
          }
          onRefresh={onRefresh}
        />
      )
    }
    if (data?.state === "starting") {
      return (
        <PanelState
          status="server-down"
          message="The dev server is still starting. Give it a moment, then refresh."
          onRefresh={onRefresh}
        />
      )
    }
    if (data?.state === "no-recipe") {
      return (
        <PanelState
          status="server-down"
          message={
            `Nothing is listening on port ${port}, and this sandbox has no recorded ` +
            `command to start it. Ask the agent to start the dev server — it will be ` +
            `remembered for next time.`
          }
          onRefresh={onRefresh}
        />
      )
    }
    if (data?.state === "failed") {
      return (
        <PanelState
          status="error"
          message="The dev server failed to start."
          detail={data.log}
          onRefresh={onRefresh}
        />
      )
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
    <div className="relative h-full w-full overflow-hidden">
      <iframe
        src={url}
        className="border-0 bg-white"
        style={{
          width: "100%",
          height: "100%",
          ...iframeStyle,
        }}
        title="Live preview"
        onLoad={() => setFrameLoaded(true)}
      />
      {/* A dev server answers HTTP well before it can serve the app — Vite and
          Next pre-bundle on first request — so the frame can sit blank for a
          long time after we call the server ready. Cover it until the frame
          reports it finished loading, otherwise "still building" is
          indistinguishable from "broken". */}
      {!frameLoaded && (
        <div className="absolute inset-0 bg-card">
          <PanelState status="loading" message="Loading preview…" />
        </div>
      )}
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
