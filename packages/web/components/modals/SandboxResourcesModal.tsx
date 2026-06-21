"use client"

import { useState, useEffect } from "react"
import { Cpu, Loader2, AlertTriangle } from "lucide-react"
import { BaseDialog } from "@/components/modals/BaseDialog"
import {
  SANDBOX_RESOURCE_BOUNDS,
  type SandboxResourceKey,
  type SandboxResources,
} from "@/lib/sandbox-resources"

interface SandboxResourcesModalProps {
  open: boolean
  onClose: () => void
  sandboxId: string | null
  isMobile?: boolean
}

const RESOURCE_KEYS: SandboxResourceKey[] = ["cpu", "memory", "disk"]

interface ResourceState {
  resources: SandboxResources
  /** Original values, to detect decreases and disk changes. */
  initial: SandboxResources
}

/** A labeled range slider for one resource dimension. */
function ResourceSlider({
  resourceKey,
  value,
  min,
  onChange,
}: {
  resourceKey: SandboxResourceKey
  value: number
  /** Lower bound the user may select — the current value (no shrinking). */
  min: number
  onChange: (value: number) => void
}) {
  const bound = SANDBOX_RESOURCE_BOUNDS[resourceKey]
  return (
    <div className="py-2">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-sm font-medium">{bound.label}</span>
        <span className="text-sm tabular-nums text-muted-foreground">
          {value} {bound.unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={bound.max}
        step={bound.step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-primary cursor-pointer"
        aria-label={`${bound.label} (${bound.unit})`}
      />
      <div className="flex justify-between text-[11px] text-muted-foreground mt-0.5">
        <span>{bound.min}</span>
        <span>{bound.max}</span>
      </div>
    </div>
  )
}

export function SandboxResourcesModal({
  open,
  onClose,
  sandboxId,
  isMobile = false,
}: SandboxResourcesModalProps) {
  const [state, setState] = useState<ResourceState | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Fetch current resources when the modal opens.
  useEffect(() => {
    if (!open || !sandboxId) return
    let cancelled = false
    setIsLoading(true)
    setError(null)
    setState(null)
    ;(async () => {
      try {
        const res = await fetch(`/api/sandbox/resize?sandboxId=${encodeURIComponent(sandboxId)}`)
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || "Failed to load sandbox resources")
        if (cancelled) return
        const resources: SandboxResources = data.resources
        setState({ resources: { ...resources }, initial: { ...resources } })
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load resources")
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, sandboxId])

  const handleChange = (key: SandboxResourceKey, value: number) => {
    setState((prev) =>
      prev ? { ...prev, resources: { ...prev.resources, [key]: value } } : prev
    )
  }

  const hasChanges =
    state != null &&
    RESOURCE_KEYS.some((k) => state.resources[k] !== state.initial[k])

  const diskChanged = state != null && state.resources.disk !== state.initial.disk

  const handleSave = async () => {
    if (!sandboxId || !state || !hasChanges || isSaving) return
    setIsSaving(true)
    setError(null)
    try {
      // Only send fields that actually changed (partial resize).
      const payload: Partial<SandboxResources> & { sandboxId: string } = { sandboxId }
      for (const k of RESOURCE_KEYS) {
        if (state.resources[k] !== state.initial[k]) payload[k] = state.resources[k]
      }
      const res = await fetch("/api/sandbox/resize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || data.error || "Resize failed")
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Resize failed")
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <BaseDialog
      open={open}
      onClose={onClose}
      title="Sandbox resources"
      icon={<Cpu className="h-4 w-4 text-muted-foreground" />}
      isMobile={isMobile}
    >
      <div className="space-y-1">
        {isLoading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : !state ? (
          <p className="py-6 text-sm text-destructive">
            {error ?? "Unable to load sandbox resources."}
          </p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground mb-2">
              Scale this sandbox&apos;s resources. CPU and RAM apply immediately;
              resources can only be increased.
            </p>

            {RESOURCE_KEYS.map((key) => (
              <ResourceSlider
                key={key}
                resourceKey={key}
                value={state.resources[key]}
                min={state.initial[key]}
                onChange={(v) => handleChange(key, v)}
              />
            ))}

            {diskChanged && (
              <div className="flex items-start gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>
                  Changing disk size restarts the sandbox, interrupting any
                  running agent. This may take a moment.
                </span>
              </div>
            )}

            {error && <p className="text-sm text-destructive pt-1">{error}</p>}
          </>
        )}

        <div className="flex items-center justify-end gap-3 border-t border-border pt-3 mt-2">
          <button
            onClick={onClose}
            disabled={isSaving}
            className="rounded-md hover:bg-accent transition-colors px-3 py-1.5 text-sm cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving || !hasChanges}
            className="rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors px-3 py-1.5 text-sm cursor-pointer disabled:opacity-50 flex items-center gap-2"
          >
            {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
            {isSaving ? "Resizing…" : "Apply"}
          </button>
        </div>
      </div>
    </BaseDialog>
  )
}
