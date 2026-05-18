"use client"

import { cn } from "@/lib/utils"

interface ClaudeUsageIndicatorProps {
  /** Number of messages used in current period */
  used: number | null
  /** Remaining messages (free users only) */
  remaining: number | null
  /** Daily limit (free users only) */
  total: number | null
  /** Whether user is pro */
  isPro: boolean
  /** Reset time ISO string */
  resetAt: string | null
  /** Whether usage is tracked weekly (pro) vs daily (free) */
  isWeekly?: boolean
  /** Additional class names */
  className?: string
}

/**
 * Displays Claude usage information for users on the shared pool.
 * - Free users: "X/10 Claude prompts used" (daily)
 * - Pro users: "X Claude prompts sent this week" (weekly)
 * - Users with own API key: not shown (used is null)
 */
export function ClaudeUsageIndicator({
  used,
  remaining,
  total,
  isPro,
  resetAt,
  isWeekly = false,
  className,
}: ClaudeUsageIndicatorProps) {
  // Don't show if user has their own API key (not using shared pool)
  if (used === null) return null

  // Calculate color for free users based on remaining
  const getColorClass = () => {
    if (isPro) return "text-muted-foreground"
    if (remaining === null || total === null) return "text-muted-foreground"
    const percentRemaining = remaining / total
    if (percentRemaining <= 0) return "text-destructive"
    if (percentRemaining <= 0.2) return "text-amber-500"
    return "text-muted-foreground"
  }

  // Format reset time for tooltip
  const formatResetTime = () => {
    if (!resetAt) return null
    try {
      const date = new Date(resetAt)
      return date.toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      })
    } catch {
      return null
    }
  }

  const resetTime = formatResetTime()
  const tooltip = resetTime ? `Resets at ${resetTime}` : undefined

  return (
    <div className={cn("text-sm", getColorClass(), className)} title={tooltip}>
      {isPro ? (
        <>{used} Claude prompts sent {isWeekly ? "this week" : "today"}</>
      ) : (
        <>{used}/{total} Claude prompts used</>
      )}
    </div>
  )
}
