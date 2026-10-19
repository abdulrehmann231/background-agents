"use client"

import { useLayoutEffect, useState } from "react"
import { supportsReasoningEffort } from "@background-agents/sdk/reasoning-effort"
import { reasoningEffortCapability } from "@/lib/reasoning-effort"

/** Remembers the reasoning-effort level per agent/model on this device. */
export function useReasoningEffortPreference(agent: string, model: string) {
  const key = `backgrounder-reasoning-effort:${JSON.stringify([agent, model])}`
  const capability = reasoningEffortCapability(agent, model)
  const [selection, setSelection] = useState({ key: "", value: "default" })

  useLayoutEffect(() => {
    let saved: string | null = null
    try {
      saved = localStorage.getItem(key)
    } catch (error) {
      // Blocked storage only means the choice isn't remembered across reloads.
      console.warn("[reasoning-effort] Could not read the saved level:", error)
    }
    setSelection({ key, value: saved || "default" })
  }, [key])

  const saved = selection.key === key ? selection.value : "default"
  // A saved level this model doesn't offer falls back to Default.
  const reasoningEffort = supportsReasoningEffort(capability, saved) ? saved : "default"

  function setReasoningEffort(value: string) {
    setSelection({ key, value })
    try {
      localStorage.setItem(key, value)
    } catch (error) {
      console.warn("[reasoning-effort] Could not save the level:", error)
    }
  }

  return { reasoningEffort, setReasoningEffort, capability }
}
