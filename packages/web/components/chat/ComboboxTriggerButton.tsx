"use client"

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react"
import { ChevronDown } from "lucide-react"
import { cn, mergeRefs } from "@/lib/utils"
import { useCollapsibleLabel } from "@/lib/hooks/useCollapsibleLabel"

interface ComboboxTriggerButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Leading icon, already sized by the caller (e.g. via `isMobile`) */
  icon: ReactNode
  /** Label shown next to the icon once there's room for it */
  label: ReactNode
  /** Mobile layout: slightly larger icons */
  isMobile?: boolean
  /**
   * Forces the label on (`true`) or off (`false`) regardless of available
   * space — e.g. a parent coordinating several triggers' labels as one
   * group. Omit (`undefined`) to let the trigger decide for itself based on
   * its own available room.
   */
  showLabel?: boolean
}

/**
 * Shared trigger button for the chat header's combobox/dropdown selectors
 * (repo, branch, MCP servers, agent/model). Renders an icon, a label that
 * collapses to icon-only when there isn't room for it — based on actual
 * overflow rather than a fixed breakpoint, since repo/branch names are
 * arbitrary-length (see useCollapsibleLabel) — and a trailing chevron.
 * `showLabel` forces the label on or off regardless of space, for a parent
 * coordinating several triggers' labels as one group (the composer's left/
 * right side groups) or a layout with generous, fixed horizontal room (the
 * scheduled-job form, which forces it on).
 *
 * Forwards its ref and spreads extra props so it can be used as the child of
 * `PopoverTrigger asChild` (Radix clones the child and merges its own props
 * in) as well as a plain standalone button. Returning a hidden measurement
 * sibling alongside the button is safe under `asChild`: Radix's Slot clones
 * the single `<ComboboxTriggerButton/>` element it was given, not whatever
 * that component renders internally.
 */
export const ComboboxTriggerButton = forwardRef<
  HTMLButtonElement,
  ComboboxTriggerButtonProps
>(function ComboboxTriggerButton(
  { icon, label, isMobile = false, showLabel: forceShowLabel, className, disabled, ...props },
  forwardedRef
) {
  const { itemRef, measureRef, showLabel: fits } = useCollapsibleLabel<HTMLButtonElement>()
  const showLabel = forceShowLabel ?? fits
  return (
    <>
      <button
        ref={mergeRefs(forwardedRef, itemRef)}
        type="button"
        disabled={disabled}
        className={cn(
          "flex items-center gap-1 overflow-hidden text-muted-foreground hover:text-foreground transition-colors cursor-pointer text-sm",
          disabled && "opacity-50 cursor-not-allowed",
          className
        )}
        {...props}
      >
        {icon}
        <span className={cn("whitespace-nowrap", showLabel ? "inline" : "hidden")}>
          {label}
        </span>
        <ChevronDown
          className={cn("shrink-0", isMobile ? "h-4 w-4" : "h-3.5 w-3.5", isMobile && !showLabel && "hidden")}
        />
      </button>
      {/* Hidden clone of the full icon+label content, measured by
          useCollapsibleLabel to decide whether the label above fits. Not
          needed when a parent is already forcing the label on or off. */}
      {forceShowLabel === undefined && (
        <span
          ref={measureRef}
          aria-hidden="true"
          className="pointer-events-none invisible fixed left-0 top-0 flex items-center gap-1 whitespace-nowrap text-sm"
        >
          {icon}
          <span>{label}</span>
        </span>
      )}
    </>
  )
})
