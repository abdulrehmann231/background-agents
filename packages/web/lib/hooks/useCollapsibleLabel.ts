"use client"

import { useLayoutEffect, useRef, useState } from "react"

/**
 * Collapses an inline label to icon-only exactly when showing it would make
 * the surrounding row overflow, instead of guessing with a fixed container
 * breakpoint. A fixed breakpoint is always wrong for some content: too
 * generous for a long repo/branch name (which then wraps instead of
 * collapsing) and too conservative for a short one (hidden well before it
 * needed to be).
 *
 * Attach `itemRef` to the trigger's own root node — a direct child of the
 * flex row being measured; its `parentElement` is read as that row, same
 * convention as `useUpwardMenuMaxHeight`. Attach `measureRef` to a hidden
 * clone of the full icon+label content (always rendered, off-screen,
 * `aria-hidden`, same markup/classes as the real trigger) — measuring must
 * never touch the thing being displayed: swapping the real item's current
 * width for that clone's always-full natural width is what lets the check
 * below answer "would showing the label fit?" without ever having to hide
 * the label first to find out (which would shrink the row, look like it
 * fits, show the label again, and repeat forever).
 *
 * Requires the label itself to use `whitespace-nowrap`: without it, a flex
 * item's default `min-width: auto` lets the browser "solve" tight space by
 * wrapping the text internally, which never produces the row overflow this
 * hook checks for.
 */
export function useCollapsibleLabel<T extends HTMLElement = HTMLElement>() {
  const itemRef = useRef<T | null>(null)
  const measureRef = useRef<HTMLElement | null>(null)
  const [showLabel, setShowLabel] = useState(true)

  useLayoutEffect(() => {
    const item = itemRef.current
    const row = item?.parentElement
    const measure = measureRef.current
    if (!item || !row || !measure) return

    const check = () => {
      // Sum of the row's current children, substituting this item's actual
      // (possibly already-collapsed) width for its full natural one — i.e.
      // "if this item showed its label, would everything still fit?".
      // `row.scrollWidth` can't answer that on its own: it only reports the
      // row's true content width when content already overflows; when
      // there's slack, it just equals `clientWidth` regardless of how much
      // of that space is actually used.
      const gap = parseFloat(getComputedStyle(row).columnGap || "0") || 0
      const naturalWidth = measure.offsetWidth
      let total = 0
      let visibleCount = 0
      for (const child of row.children) {
        if (child === measure) continue
        const width = child === item ? naturalWidth : child.getBoundingClientRect().width
        if (width === 0 && child !== item) continue // display:none sibling: no width, no gap
        total += width
        visibleCount++
      }
      total += Math.max(visibleCount - 1, 0) * gap
      setShowLabel(total <= row.clientWidth)
    }

    check()
    // Re-check both when the row's available space changes (window/pane
    // resize) and when the label's own natural width changes (switching to
    // a shorter or longer repo/branch name).
    const observer = new ResizeObserver(check)
    observer.observe(row)
    observer.observe(measure)
    return () => observer.disconnect()
  }, [])

  return { itemRef, measureRef, showLabel }
}
