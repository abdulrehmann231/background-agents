"use client"

import { useEffect } from "react"
import { useTheme } from "next-themes"

/**
 * Keeps the browser tab's favicon in sync with the active theme.
 *
 * `app/layout.tsx` renders static <link rel="icon" media="..."> tags that
 * pick a light/dark mask icon from the OS `prefers-color-scheme` before any
 * JS runs (avoids a flash of the wrong icon). Those only track the OS
 * setting though, so once next-themes resolves the *actual* theme (which may
 * be a manual override from the in-app theme switcher), this swaps in a
 * single unconditional <link> that matches it.
 */
export function Favicon() {
  const { resolvedTheme } = useTheme()

  useEffect(() => {
    if (!resolvedTheme) return
    const href = resolvedTheme === "dark" ? "/mask-icon-dark.svg" : "/mask-icon-light.svg"

    // Drop the OS-preference-based <link> tags so they can't win out over
    // the resolved theme (e.g. after a manual override).
    document.querySelectorAll<HTMLLinkElement>("link[rel='icon'][media]").forEach((el) => el.remove())

    let link = document.querySelector<HTMLLinkElement>("link[rel='icon']:not([media])")
    if (!link) {
      link = document.createElement("link")
      link.rel = "icon"
      document.head.appendChild(link)
    }
    link.type = "image/svg+xml"
    link.href = href
  }, [resolvedTheme])

  return null
}
