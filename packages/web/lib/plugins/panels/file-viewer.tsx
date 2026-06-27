"use client"

import { useEffect, useMemo } from "react"
import { FileCode2 } from "lucide-react"
import type { PanelPlugin, PanelProps, PreviewItem } from "../types"
import { HighlightedCode, getFileTypeFromPath, ImageFullPreview, PdfFullPreview, isMarkdownPath, MarkdownPreview } from "@/lib/file-preview"
import { PanelState } from "./PanelState"
import { useSandboxResource, assertSandboxOk } from "@/lib/hooks/useSandboxResource"

/** Parsed file payload — text content, or an object URL for binary previews. */
type FileData =
  | { kind: "text"; content: string }
  | { kind: "binary"; blobUrl: string }

/** Fetch and parse a file from the sandbox. Throws via {@link assertSandboxOk}. */
async function loadFileData(args: {
  sandboxId: string
  filePath: string
  fileType: string
  autoStart: boolean
  signal: AbortSignal
}): Promise<FileData> {
  const { sandboxId, filePath, fileType, autoStart, signal } = args
  const isBinary = fileType === "image" || fileType === "pdf"
  const action = isBinary ? "read-file-binary" : "read-file"

  const res = await fetch("/api/sandbox/files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sandboxId, action, filePath, autoStart }),
    signal,
  })
  await assertSandboxOk(res)

  if (isBinary) {
    const blob = await res.blob()
    // Don't leak an object URL for a load that was aborted mid-flight.
    if (signal.aborted) throw new DOMException("Aborted", "AbortError")
    return { kind: "binary", blobUrl: URL.createObjectURL(blob) }
  }

  const data = await res.json().catch(() => ({}) as { content?: unknown })
  return { kind: "text", content: typeof data.content === "string" ? data.content : "" }
}

function FileViewerComponent({ item, sandboxId, messages, explicitStart, onRefresh }: PanelProps) {
  const filePath = item.type === "file" ? item.filePath : ""
  const fileType = getFileTypeFromPath(filePath)

  // Re-fetch when the agent finishes editing this file. Each completed
  // Edit/Write tool call targeting this path (output attached = tool finished)
  // bumps the count, which re-runs the load below.
  const editSignal = useMemo(() => {
    if (!filePath || !messages) return 0
    let count = 0
    for (const message of messages) {
      for (const block of message.contentBlocks ?? []) {
        if (block.type !== "tool_calls") continue
        for (const tc of block.toolCalls) {
          if (
            (tc.tool === "Edit" || tc.tool === "Write") &&
            tc.filePath === filePath &&
            tc.output
          ) {
            count++
          }
        }
      }
    }
    return count
  }, [messages, filePath])

  const { status, data, error } = useSandboxResource<FileData>({
    sandboxId,
    explicitStart,
    deps: [filePath, fileType, editSignal],
    load: ({ autoStart, signal }) =>
      loadFileData({ sandboxId: sandboxId!, filePath, fileType, autoStart, signal }),
  })

  // Revoke the previous object URL when it changes or on unmount.
  const blobUrl = data?.kind === "binary" ? data.blobUrl : null
  useEffect(() => {
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl)
    }
  }, [blobUrl])

  if (status === "loading") return <PanelState status="loading" />
  if (status === "stopped") return <PanelState status="stopped" onRefresh={onRefresh} />
  if (status === "expired") return <PanelState status="expired" onRefresh={onRefresh} />
  if (status === "error") {
    return <PanelState status="error" message={error ?? undefined} onRefresh={onRefresh} />
  }

  const content = data?.kind === "text" ? data.content : ""

  // Image preview
  if (fileType === "image" && blobUrl) {
    return <ImageFullPreview src={blobUrl} alt={filePath} className="h-full" />
  }

  // PDF preview
  if (fileType === "pdf" && blobUrl) {
    return <PdfFullPreview src={blobUrl} title={filePath} className="h-full" height="100%" />
  }

  // Markdown preview with GitHub-style rendering
  if (isMarkdownPath(filePath)) {
    return <MarkdownPreview content={content} className="h-full" currentFilePath={filePath} />
  }

  // Code/text preview with syntax highlighting
  return <HighlightedCode code={content} filename={filePath} className="h-full" />
}

export const FileViewerPlugin: PanelPlugin = {
  id: "file-viewer",

  canHandle: (item: PreviewItem) => item.type === "file",

  getLabel: (item: PreviewItem) => {
    if (item.type === "file") {
      return item.filename
    }
    return "File"
  },

  getIcon: () => FileCode2,

  Component: FileViewerComponent,
}
