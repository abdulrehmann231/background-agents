"use client"

import { useRef, useCallback, useEffect } from "react"
import { MIN_WIDTH, MAX_WIDTH, COLLAPSE_THRESHOLD } from "@/lib/contexts"

interface UseSidebarResizeOptions {
  isMobile: boolean
  collapsed: boolean
  onToggleCollapse: () => void
  onWidthChange: (width: number) => void
}

export function useSidebarResize({
  isMobile,
  collapsed,
  onToggleCollapse,
  onWidthChange,
}: UseSidebarResizeOptions) {
  const isResizing = useRef(false)

  const startResizing = useCallback((e: React.MouseEvent) => {
    if (isMobile) return
    e.preventDefault()
    isResizing.current = true
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
  }, [isMobile])

  const stopResizing = useCallback(() => {
    isResizing.current = false
    document.body.style.cursor = ""
    document.body.style.userSelect = ""
  }, [])

  const resize = useCallback((e: MouseEvent) => {
    if (!isResizing.current || isMobile) return
    if (e.clientX < COLLAPSE_THRESHOLD) {
      if (!collapsed) {
        onToggleCollapse()
      }
      return
    }
    if (collapsed && e.clientX >= COLLAPSE_THRESHOLD) {
      onToggleCollapse()
      onWidthChange(MIN_WIDTH)
      return
    }
    const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, e.clientX))
    onWidthChange(newWidth)
  }, [onWidthChange, collapsed, onToggleCollapse, isMobile])

  useEffect(() => {
    if (isMobile) return
    window.addEventListener("mousemove", resize)
    window.addEventListener("mouseup", stopResizing)
    return () => {
      window.removeEventListener("mousemove", resize)
      window.removeEventListener("mouseup", stopResizing)
    }
  }, [resize, stopResizing, isMobile])

  return { startResizing }
}
