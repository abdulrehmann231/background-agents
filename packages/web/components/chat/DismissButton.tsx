"use client"

import { X } from "lucide-react"
import { cn } from "@/lib/utils"

type DismissButtonVariant = "default" | "destructive" | "tinted"

interface DismissButtonProps {
  /**
   * Accessible name *and* tooltip text for the action (e.g. "Remove
   * repository"). Applied to both `title` and `aria-label` so a call site
   * can't set one and forget the other — pass `ariaLabel` only when the
   * screen-reader wording genuinely needs to differ from the tooltip.
   */
  label: string
  ariaLabel?: string
  onClick: () => void
  isMobile?: boolean
  /**
   * Color treatment:
   *  - "default": neutral card surface (muted-foreground → foreground, accent hover).
   *  - "destructive": flags a destructive/error action.
   *  - "tinted": for use on a colored banner surface — hover feedback follows
   *    the current text color instead of a fixed accent, so it reads
   *    correctly on both the yellow and red warning tints.
   */
  variant?: DismissButtonVariant
  className?: string
}

const VARIANT_CLASS: Record<DismissButtonVariant, string> = {
  default: "text-muted-foreground hover:text-foreground hover:bg-accent",
  destructive: "text-destructive/70 hover:text-destructive hover:bg-destructive/10",
  tinted: "opacity-70 hover:opacity-100 hover:bg-foreground/10",
}

/**
 * Small "X" icon button for dismissing a banner or removing an attached
 * item (repo, pending file, error message). Single source of truth for the
 * dismiss/remove affordance so every instance gets the same hit target,
 * hover feedback, and both accessibility attributes.
 */
export function DismissButton({
  label,
  ariaLabel,
  onClick,
  isMobile = false,
  variant = "default",
  className,
}: DismissButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={ariaLabel ?? label}
      className={cn(
        "shrink-0 flex items-center justify-center rounded-md transition-colors cursor-pointer",
        isMobile ? "p-1.5" : "p-0.5",
        VARIANT_CLASS[variant],
        className
      )}
    >
      <X className={cn(isMobile ? "h-4 w-4" : "h-3.5 w-3.5")} />
    </button>
  )
}
