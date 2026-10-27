import type { PreviewItem, PanelPlugin } from "./types"
import { FileViewerPlugin } from "./panels/file-viewer"
import { FileBrowserPlugin } from "./panels/file-browser"
import { TerminalPlugin } from "./panels/terminal"
import { ServerPreviewPlugin } from "./panels/server-preview"
import { ChangesPlugin } from "./panels/changes"

/**
 * All registered panel plugins.
 * Order matters - first matching plugin wins.
 */
const panelPlugins: PanelPlugin[] = [
  FileViewerPlugin,
  FileBrowserPlugin,
  TerminalPlugin,
  ServerPreviewPlugin,
  ChangesPlugin,
]

/**
 * Find the plugin that can handle the given preview item.
 */
export function getPanelPlugin(item: PreviewItem): PanelPlugin | null {
  return panelPlugins.find((plugin) => plugin.canHandle(item)) ?? null
}
