"use client"

import { useId, useState } from "react"
import { Gauge } from "lucide-react"
import { cn } from "@/lib/utils"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"

const EFFORT_LEVELS = ["low", "medium", "high"] as const

function effortLabel(value: string): string {
  return value[0].toUpperCase() + value.slice(1)
}

/**
 * Cosmetic-only "Effort" selector, structurally identical to ThinkingSelector
 * (same container, breakpoint, and mobile treatment) so the two sit
 * consistently side by side. Unlike ThinkingSelector it isn't backed by any
 * real agent capability — there's no SDK concept of "effort" distinct from
 * thinking (see thinkingArgs' `*-effort` control values, which are just
 * thinking-level CLI flag names). This exists only so Eliza — a fake,
 * regex-based test agent — has a second no-op control to exercise the
 * composer's layout with. Entirely self-contained: the chosen value isn't
 * read by anything and isn't sent anywhere.
 */
export function EffortSelector({ isMobile = false }: { isMobile?: boolean }) {
  const helpId = useId()
  const [value, setValue] = useState("default")
  const explanation = "Cosmetic only — Eliza is a fake test agent and doesn't act on this. For exercising the composer layout, not a real capability."
  return <div className={cn("relative flex shrink-0 items-center gap-1 text-sm text-muted-foreground", isMobile && "max-w-[45%] flex-wrap justify-end")}>
    <Select value={value} onValueChange={setValue}>
      <SelectTrigger aria-label="Effort level" aria-describedby={helpId} title={explanation}
        className={cn("h-auto w-auto max-w-full gap-1 border-0 bg-transparent p-0 text-sm text-muted-foreground hover:text-foreground focus-visible:ring-2", isMobile && "min-h-9")}
        iconClassName={isMobile ? "h-4 w-4" : undefined}>
        <Gauge aria-hidden="true" className={cn("shrink-0", isMobile ? "h-4 w-4" : "h-3.5 w-3.5")} />
        <span className={cn(!isMobile && "hidden @[32rem]:inline")}><SelectValue /></span>
      </SelectTrigger>
      <SelectContent side="top" align="end" className="max-h-[min(28rem,var(--radix-select-content-available-height))] max-w-[calc(100vw-2rem)]">
        <SelectItem value="default" title={explanation} aria-describedby={helpId}>Default</SelectItem>
        {EFFORT_LEVELS.map(level => <SelectItem key={level} value={level}>{effortLabel(level)}</SelectItem>)}
      </SelectContent>
    </Select>
    <span id={helpId} className="sr-only">{explanation}</span>
  </div>
}
