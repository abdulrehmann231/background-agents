"use client"

import { cn } from "@/lib/utils"
import { TRIGGER_TYPES } from "./constants"

interface TriggerToggleProps {
  value: "interval" | "incoming"
  onChange: (value: "interval" | "incoming") => void
}

/**
 * Segmented control choosing between a scheduled (interval) trigger and an
 * incoming webhook. Always editable — the PATCH on save handles the swap for
 * both still-open drafts and existing jobs.
 */
export function TriggerToggle({ value, onChange }: TriggerToggleProps) {
  return (
    <div>
      <label className="block text-sm font-medium mb-2">Trigger</label>
      <div className="inline-flex rounded-md bg-muted p-0.5">
        {TRIGGER_TYPES.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => onChange(t.value)}
            className={cn(
              "px-3 py-1 text-sm rounded-md transition-colors cursor-pointer",
              value === t.value
                ? "bg-background shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  )
}
