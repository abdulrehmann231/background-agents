import type { LucideIcon } from "lucide-react"

/**
 * Data passed when opening a preview panel.
 * Each item type is handled by a specific plugin.
 */
export type PreviewItem =
  | { type: "file"; filePath: string; filename: string }
  | { type: "terminal"; id: string }
  | { type: "server"; port: number; url: string }

/**
 * Props passed to every panel plugin component.
 */
export interface PanelProps {
  item: PreviewItem
  sandboxId: string | null
  /** The chat this preview belongs to, so a panel can trigger sandbox recovery. */
  chatId?: string | null
  /**
   * Called after a panel recreates a dead sandbox (e.g. the server-preview
   * panel's "expired" recovery), with the fresh sandboxId. The caller should
   * persist it onto the chat so sandboxId prop updates and future requests
   * target the new sandbox instead of the deleted one.
   *
   * `serverUrl` is passed when the recreated sandbox has a new preview URL
   * for the panel's port (preview URLs are sandbox-scoped, so a recreation
   * always changes it) — the caller should also patch the matching `server`
   * PreviewItem's `url` so the iframe and "open in new window" don't keep
   * pointing at the deleted sandbox.
   */
  onSandboxRecreated?: (sandboxId: string, serverUrl?: { port: number; url: string }) => void
  /**
   * Called by a panel whenever its own ability to recover from "expired"
   * changes — `recover` while expired (a function resolving to the fresh URL,
   * or null on failure), `null` otherwise. Lets a parent that renders UI
   * outside the panel (PreviewView's "open in new window" button) trigger the
   * same recreate-then-resume flow before acting, without re-probing the
   * sandbox itself or duplicating the expired/recreate logic.
   */
  onRecoverableChange?: (recover: (() => Promise<string | null>) | null) => void
  /** Optional scale factor for preview (e.g., 0.5, 0.75, 1) */
  scale?: number
  /** All messages in the current chat, for plugins that need live content */
  messages?: import("@/lib/types").Message[]
  /**
   * Bumped on every explicit refresh (top-bar button or an in-panel retry).
   * Included in the panel's React key, so a bump remounts and reloads it.
   */
  refreshNonce: number
  /**
   * True when the current mount was caused by an explicit user refresh, so the
   * panel may boot a stopped sandbox. Resets when switching preview items, so
   * merely opening a stopped sandbox's file never auto-boots it.
   */
  explicitStart: boolean
  /**
   * The single refresh path. A panel's in-panel retry (e.g. PanelState's
   * button) calls this so it behaves exactly like the top-bar refresh.
   */
  onRefresh: () => void
}

/**
 * A panel plugin definition.
 */
export interface PanelPlugin {
  /** Unique identifier */
  id: string

  /** Check if this plugin can handle the given item */
  canHandle: (item: PreviewItem) => boolean

  /** Display label for the titlebar */
  getLabel: (item: PreviewItem) => string

  /** Icon for the titlebar */
  getIcon: () => LucideIcon

  /** The React component to render */
  Component: React.ComponentType<PanelProps>
}
