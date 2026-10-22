"use client"

import { useEffect, useState } from "react"
import * as Dialog from "@radix-ui/react-dialog"
import { Loader2, HardDrive } from "lucide-react"
import { cn } from "@/lib/utils"
import { ModalHeader, focusChatPrompt } from "@/components/ui/modal-header"

interface SandboxResizeModalProps {
  open: boolean
  onClose: () => void
  /** Sandbox to resize. Null (no active chat/sandbox) disables the submit button. */
  sandboxId: string | null
  isMobile?: boolean
}

const MIN_GB = 1
const MAX_GB = 10
const DEFAULT_MEMORY_GB = 2
const DEFAULT_DISK_GB = 5

function clamp(value: number, floor: number = MIN_GB): number {
  return Math.min(Math.max(value, floor), MAX_GB)
}

function sliderClasses() {
  return cn(
    "relative w-full h-1.5 appearance-none rounded-full bg-muted cursor-pointer accent-primary",
    "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
    "[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4",
    "[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary",
    "[&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-background",
    "[&::-webkit-slider-thumb]:shadow [&::-webkit-slider-thumb]:cursor-grab",
    "[&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full",
    "[&::-moz-range-thumb]:bg-primary [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-background",
    "disabled:opacity-50 disabled:cursor-not-allowed"
  )
}

/**
 * A 1-10 GB slider with the segment below `floor` visually greyed out and
 * unreachable, rather than shrinking the slider's own min — the full 1-10
 * range stays visible so "GB you can't go below" and "GB that don't exist"
 * read differently.
 */
function ResourceSlider({
  id,
  label,
  value,
  floor,
  disabled,
  onChange,
}: {
  id: string
  label: string
  value: number
  /** Lowest value the thumb may land on; null while still loading. */
  floor: number | null
  disabled: boolean
  onChange: (value: number) => void
}) {
  const effectiveFloor = floor ?? MIN_GB
  const disabledPct = ((effectiveFloor - MIN_GB) / (MAX_GB - MIN_GB)) * 100

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label htmlFor={id} className="text-xs text-muted-foreground">
          {label}
        </label>
        <span className="text-sm font-medium tabular-nums">{value} GB</span>
      </div>
      <div className="relative flex items-center">
        <input
          id={id}
          type="range"
          min={MIN_GB}
          max={MAX_GB}
          step={1}
          value={value}
          onChange={(e) => onChange(clamp(Number(e.target.value), effectiveFloor))}
          disabled={disabled}
          aria-label={`${label} in GB`}
          aria-valuemin={effectiveFloor}
          className={sliderClasses()}
        />
        {/* Greys out the unreachable segment below the current allocation —
            purely visual, pointer-events-none so dragging still goes through
            to the input underneath; onChange clamps anything landing here. */}
        {disabledPct > 0 && (
          <div
            className="absolute left-0 h-1.5 rounded-l-full bg-foreground/15 pointer-events-none"
            style={{ width: `${disabledPct}%` }}
          />
        )}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-muted-foreground tabular-nums">
        <span>{MIN_GB} GB{floor != null && floor > MIN_GB ? ` (current: ${floor})` : ""}</span>
        <span>{MAX_GB} GB</span>
      </div>
    </div>
  )
}

/**
 * Admin-only modal to bump a sandbox's RAM and disk allocation, up to 10 GiB
 * each. Opened from the chat title menu and the Cmd/Ctrl+K command palette
 * (both gated on `session.user.isAdmin` by the caller — this component
 * doesn't re-check admin-ness, the API route does via `requireAdmin`).
 */
export function SandboxResizeModal({ open, onClose, sandboxId, isMobile = false }: SandboxResizeModalProps) {
  const [memory, setMemory] = useState(DEFAULT_MEMORY_GB)
  const [disk, setDisk] = useState(DEFAULT_DISK_GB)
  // Floors below which the sliders won't go — Daytona only supports growing
  // memory/disk, never shrinking (hot resize can only increase CPU/memory,
  // and disk resize throws on any decrease). Null until we've loaded the
  // sandbox's actual current allocation.
  const [memoryFloor, setMemoryFloor] = useState<number | null>(null)
  const [diskFloor, setDiskFloor] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  // On open, load what's actually provisioned right now rather than
  // snapping the sliders back to a hardcoded default — otherwise a resize
  // that already landed would look reverted the next time this opens. This
  // also sets the floor the sliders can't be dragged below, since the
  // Daytona API rejects any decrease.
  useEffect(() => {
    if (!open) return
    setError(null)
    setSuccess(false)
    setSubmitting(false)

    if (!sandboxId) {
      setMemory(DEFAULT_MEMORY_GB)
      setDisk(DEFAULT_DISK_GB)
      setMemoryFloor(null)
      setDiskFloor(null)
      return
    }

    let cancelled = false
    setLoading(true)
    fetch(`/api/sandbox/resize?sandboxId=${encodeURIComponent(sandboxId)}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return
        if (typeof data.memory === "number") {
          // Ceil the floor so a fractional current value (e.g. 2.3 GiB)
          // never leaves the slider sitting below what's actually allocated.
          const floor = clamp(Math.ceil(data.memory))
          setMemoryFloor(floor)
          setMemory(clamp(Math.round(data.memory), floor))
        }
        if (typeof data.disk === "number") {
          const floor = clamp(Math.ceil(data.disk))
          setDiskFloor(floor)
          setDisk(clamp(Math.round(data.disk), floor))
        }
      })
      .catch((e) => {
        if (!cancelled) {
          console.error("[SandboxResizeModal] Failed to load current resources:", e)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [open, sandboxId])

  const submit = async () => {
    if (!sandboxId || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch("/api/sandbox/resize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sandboxId, memory, disk }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || "Could not resize sandbox")
      }
      // Reflect exactly what the server applied, in case it differs from the
      // request (e.g. it clamps/rounds), so the sliders stay truthful. The
      // new value also becomes the new floor, since it can't be shrunk back.
      if (typeof data.memory === "number") {
        const floor = clamp(Math.ceil(data.memory))
        setMemoryFloor(floor)
        setMemory(clamp(Math.round(data.memory), floor))
      }
      if (typeof data.disk === "number") {
        const floor = clamp(Math.ceil(data.disk))
        setDiskFloor(floor)
        setDisk(clamp(Math.round(data.disk), floor))
      }
      setSuccess(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not resize sandbox")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/25 backdrop-blur-[1px]" />
        <Dialog.Content
          onCloseAutoFocus={(e) => { e.preventDefault(); focusChatPrompt() }}
          className={cn(
            "fixed z-50 bg-popover overflow-hidden flex flex-col",
            isMobile
              ? "inset-x-4 top-1/2 -translate-y-1/2 rounded-xl border border-border"
              : "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-sm border border-border rounded-xl shadow-xl"
          )}
        >
          <ModalHeader
            title={
              <>
                <HardDrive className="h-4 w-4 text-muted-foreground" />
                Sandbox resources
              </>
            }
          />

          <div className="px-4 pt-2 pb-4 space-y-5">
            <p className="text-xs text-muted-foreground">
              Admin only. Resources can only be increased, not decreased.
              Increasing disk requires briefly stopping the sandbox.
            </p>

            <ResourceSlider
              id="resize-memory"
              label="RAM"
              value={memory}
              floor={memoryFloor}
              disabled={submitting || loading}
              onChange={setMemory}
            />

            <ResourceSlider
              id="resize-disk"
              label="Disk space"
              value={disk}
              floor={diskFloor}
              disabled={submitting || loading}
              onChange={setDisk}
            />

            {error && <p className="text-xs text-destructive">{error}</p>}
            {success && !error && (
              <p className="text-xs text-green-600 dark:text-green-500">
                Resize complete.
              </p>
            )}

            <button
              type="button"
              onClick={submit}
              disabled={!sandboxId || submitting || loading}
              className={cn(
                "flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2.5 text-sm font-medium text-primary-foreground",
                "transition-colors hover:bg-primary/90 cursor-pointer",
                "focus:outline-none focus:ring-2 focus:ring-ring/60",
                "disabled:opacity-50 disabled:cursor-not-allowed"
              )}
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {submitting ? "Resizing…" : !sandboxId ? "No sandbox" : "Apply"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
