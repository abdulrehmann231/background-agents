"use client"

import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Sortable `<th>` with a label and an arrow indicating the active sort field
 * and direction. Shared by the admin tables (UserTable, UsageByUserTable),
 * which each sort over a different field union — generic over `F` so callers
 * keep their own `SortField` type.
 */
export function SortHeader<F extends string>({
  label,
  field,
  currentField,
  currentOrder,
  onSort,
  align = "left",
  className,
  inactiveIconClassName = "opacity-50",
}: {
  label: string
  field: F
  currentField: F
  currentOrder: "asc" | "desc"
  onSort: (field: F) => void
  align?: "left" | "center" | "right"
  className?: string
  inactiveIconClassName?: string
}) {
  const isActive = currentField === field
  return (
    <th
      className={cn(
        "px-4 py-3 font-medium",
        align === "center" ? "text-center" : align === "right" ? "text-right" : "text-left",
        className
      )}
    >
      <button
        onClick={() => onSort(field)}
        className={cn(
          "inline-flex items-center gap-1 hover:text-foreground",
          align === "right" && "flex-row-reverse"
        )}
      >
        {label}
        {isActive ? (
          currentOrder === "asc" ? (
            <ArrowUp className="h-3 w-3" />
          ) : (
            <ArrowDown className="h-3 w-3" />
          )
        ) : (
          <ArrowUpDown className={cn("h-3 w-3", inactiveIconClassName)} />
        )}
      </button>
    </th>
  )
}
