"use client"

import { useTheme } from "next-themes"
import { fmtTokens } from "@/lib/format"
import { SERIES_LIGHT, SERIES_DARK } from "@/components/charts/palette"
import type { UsageTokenMix } from "@/lib/db/user-usage"

/** The five parts a turn's tokens split into, in the order they're billed. */
const PARTS: { key: keyof UsageTokenMix; label: string; hint: string }[] = [
  { key: "input", label: "Input", hint: "Fresh prompt text sent to the model" },
  { key: "output", label: "Output", hint: "What the model wrote back" },
  { key: "cacheRead", label: "Cache read", hint: "Context served from cache — the cheap part" },
  { key: "cacheWrite", label: "Cache write", hint: "Context written into cache, priced above input" },
  { key: "reasoning", label: "Reasoning", hint: "Thinking tokens, where the model reports them" },
]

/**
 * How the window's tokens were made up — one bar, five segments.
 *
 * Worth its own figure in a coding-agent product: the split is where a user
 * finds out their spend is mostly cache writes, which is a thing they can
 * change (keeping a session warm rather than restarting it). A pie would make
 * the same five numbers harder to compare.
 */
export function TokenMixBar({ mix }: { mix: UsageTokenMix }) {
  const { resolvedTheme } = useTheme()
  const palette = resolvedTheme === "dark" ? SERIES_DARK : SERIES_LIGHT

  const parts = PARTS.map((part, i) => ({
    ...part,
    value: Number(mix[part.key]) || 0,
    color: palette[i],
  })).filter((part) => part.value > 0)

  // Total the parts rather than trusting totalTokens: the two are reported
  // separately and a segment's share has to be of what's actually drawn.
  const total = parts.reduce((acc, part) => acc + part.value, 0)

  if (total <= 0) {
    return (
      <p className="text-xs text-muted-foreground">No tokens recorded in this range.</p>
    )
  }

  return (
    <div>
      <div className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full" role="img"
        aria-label={parts
          .map((p) => `${p.label} ${Math.round((p.value / total) * 100)}%`)
          .join(", ")}
      >
        {parts.map((part) => (
          <div
            key={part.key}
            style={{ width: `${(part.value / total) * 100}%`, backgroundColor: part.color }}
            className="h-full first:rounded-l-full last:rounded-r-full"
          />
        ))}
      </div>

      <ul className="mt-3 space-y-1.5">
        {parts.map((part) => (
          <li key={part.key} className="flex items-baseline gap-2 text-xs">
            <span
              aria-hidden
              className="h-2 w-2 shrink-0 translate-y-px rounded-[2px]"
              style={{ backgroundColor: part.color }}
            />
            <span className="text-foreground" title={part.hint}>
              {part.label}
            </span>
            <span className="flex-1 border-b border-dotted border-border/60" />
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {fmtTokens(part.value)}
            </span>
            <span className="w-9 shrink-0 text-right tabular-nums text-muted-foreground">
              {Math.round((part.value / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
