"use client"

import { useCallback, useEffect, useRef, useState } from "react"

/**
 * Copies text to the clipboard and exposes a transient `copied` flag that
 * resets after `resetMs`. Centralizes the copy-button pattern that was
 * previously duplicated across CodeBlock, MarkdownPreview, and settings.
 */
export function useCopyToClipboard(resetMs = 2000) {
  const [copied, setCopied] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [])

  const copy = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text)
        setCopied(true)
        if (timeoutRef.current) clearTimeout(timeoutRef.current)
        timeoutRef.current = setTimeout(() => setCopied(false), resetMs)
        return true
      } catch (err) {
        console.error("Failed to copy:", err)
        return false
      }
    },
    [resetMs]
  )

  return { copied, copy }
}

/**
 * Extracts the text content from a `<code>` child element rendered by
 * react-markdown, used by the copy buttons on fenced code blocks.
 */
export function extractCodeText(children: React.ReactNode): string {
  const codeElement = children as React.ReactElement<{ children?: string }>
  return String(codeElement?.props?.children ?? "")
}
