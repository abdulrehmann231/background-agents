"use client"

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

interface ComboboxTriggerButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Leading icon, already sized by the caller (e.g. via `isMobile`) */
  icon: ReactNode
  /** Label shown next to the icon once the container is wide enough */
  label: ReactNode
  /** Mobile layout: slightly larger icons and a narrower reveal breakpoint */
  isMobile?: boolean
  /** Always show the label regardless of container width */
  showLabel?: boolean
}

/**
 * Shared trigger button for the chat header's combobox/dropdown selectors
 * (repo, branch, MCP servers, agent/model). Renders an icon, a label that's
 * hidden until the row has room for it, and a trailing chevron.
 *
 * Forwards its ref and spreads extra props so it can be used as the child of
 * `PopoverTrigger asChild` (Radix clones the child and merges its own props
 * in) as well as a plain standalone button.
 */
export const ComboboxTriggerButton = forwardRef<
  HTMLButtonElement,
  ComboboxTriggerButtonProps
>(function ComboboxTriggerButton(
  { icon, label, isMobile = false, showLabel = false, className, disabled, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled}
      className={cn(
        "flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors cursor-pointer text-sm",
        disabled && "opacity-50 cursor-not-allowed",
        className
      )}
      {...props}
    >
      {icon}
      <span
        className={cn(
          showLabel
            ? "inline"
            : isMobile
              ? "hidden @[16rem]/row1:inline"
              : "hidden @[32rem]:inline"
        )}
      >
        {label}
      </span>
      <ChevronDown
        className={cn(isMobile ? "h-4 w-4 hidden @[16rem]/row1:block" : "h-3.5 w-3.5")}
      />
    </button>
  )
})
