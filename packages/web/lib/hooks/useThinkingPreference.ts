"use client"

import { useLayoutEffect, useState } from "react"
import { supportsThinking } from "@background-agents/sdk/thinking"
import { thinkingCapability } from "@/lib/thinking"

/** Remembers the thinking level per agent/model on this device. */
export function useThinkingPreference(agent: string, model: string) {
  const key = `backgrounder-thinking:${JSON.stringify([agent, model])}`
  const capability = thinkingCapability(agent, model)
  const [selection, setSelection] = useState({ key: "", value: "default" })

  useLayoutEffect(() => {
    let saved: string | null = null
    try {
      saved = localStorage.getItem(key)
    } catch (error) {
      // Blocked storage only means the choice isn't remembered across reloads.
      console.warn("[thinking] Could not read the saved thinking level:", error)
    }
    setSelection({ key, value: saved || "default" })
  }, [key])

  const saved = selection.key === key ? selection.value : "default"
  // A saved level this model doesn't offer falls back to Default.
  const thinking = supportsThinking(capability, saved) ? saved : "default"

  function setThinking(value: string) {
    setSelection({ key, value })
    try {
      localStorage.setItem(key, value)
    } catch (error) {
      console.warn("[thinking] Could not save the thinking level:", error)
    }
  }

  return { thinking, setThinking, capability }
}
