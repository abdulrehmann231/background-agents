"use client"

import type { ReasoningEffortCapability } from "@background-agents/sdk/reasoning-effort"
import { reasoningEffortLabel } from "@background-agents/sdk/reasoning-effort"
import { useId } from "react"
import { Brain } from "lucide-react"
import { cn } from "@/lib/utils"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"

export function ReasoningEffortSelector({ capability, value, onChange, isMobile = false, forceShowLabel }: {
  capability: ReasoningEffortCapability; value: string; onChange: (value: string) => void; isMobile?: boolean
  /**
   * Desktop only: forces the label on (`true`) or off (`false`) regardless
   * of available space — e.g. a parent coordinating this with other
   * triggers as one group. Omit to use the fixed breakpoint below.
   */
  forceShowLabel?: boolean
}) {
  const helpId = useId()
  const explanation = "How hard the model thinks before responding. The preselected level is this agent and model's own default. Changes apply to future prompts."
  const unconfirmedExplanation = "How hard the model thinks before responding. The preselected level is our best guess at this agent and model's own default — the CLI doesn't document it explicitly, so it may be wrong. Changes apply to future prompts."
  // Models without adjustable levels have nothing to choose.
  if (!capability.levels.length) return null
  return <div className={cn("relative flex shrink-0 items-center gap-1 text-sm text-muted-foreground", isMobile && "max-w-[45%] flex-wrap justify-end")}>
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label="Reasoning effort" aria-describedby={helpId} title={explanation}
        className={cn("h-auto w-auto max-w-full gap-1 border-0 bg-transparent p-0 text-sm text-muted-foreground hover:text-foreground focus-visible:ring-2", isMobile && "min-h-9")}
        iconClassName={isMobile ? "h-4 w-4" : undefined}>
        <Brain aria-hidden="true" className={cn("shrink-0", isMobile ? "h-4 w-4" : "h-3.5 w-3.5")} />
        {/* Desktop collapses to icon-only below the same @[32rem] breakpoint
            every other composer trigger (agent/mode/repo/branch/MCP) uses.
            Mobile has no such collapse convention for this row, so it keeps
            always showing the label. This wrapper must not be a <span>: the
            shared SelectTrigger always applies `[&>span]:line-clamp-1` to its
            direct-child span (meant for Radix's own un-wrapped SelectValue
            span), and that rule's higher selector specificity than a plain
            class forces `display: -webkit-box`, permanently overriding the
            `hidden`/`@[32rem]:inline` toggle below it. A <div> isn't matched
            by that selector, so the toggle actually takes effect. */}
        <div className={cn(!isMobile && (
          forceShowLabel === undefined ? "hidden @[32rem]:inline" : (forceShowLabel ? "inline" : "hidden")
        ))}><SelectValue /></div>
      </SelectTrigger>
      <SelectContent side="top" align="end" className="max-h-[min(28rem,var(--radix-select-content-available-height))] max-w-[calc(100vw-2rem)]">
        {capability.levels.map(level => {
          // The level matching an unconfirmed defaultLevel gets a "~" marker
          // and its own tooltip, since picking it (explicitly or by default)
          // isn't a documented guarantee of the CLI's real behavior.
          const isGuessedDefault = level === capability.defaultLevel && capability.defaultLevelConfidence === "guess"
          return <SelectItem key={level} value={level} title={isGuessedDefault ? unconfirmedExplanation : undefined}>
            {isGuessedDefault ? `≈ ${reasoningEffortLabel(level)}` : reasoningEffortLabel(level)}
          </SelectItem>
        })}
      </SelectContent>
    </Select>
    <span id={helpId} className="sr-only">{explanation}</span>
  </div>
}
