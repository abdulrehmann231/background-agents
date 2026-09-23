"use client"

import { Infinity as InfinityIcon, KeyRound, TriangleAlert } from "lucide-react"
import { useSession } from "next-auth/react"
import { cn } from "@/lib/utils"
import { useModals } from "@/lib/contexts"
import { useSettingsQuery } from "@/lib/query/hooks/useSettingsQuery"
import { fmtBalance } from "@/lib/format"

/** Below this, the balance is close enough to empty to be worth flagging. */
const LOW_BALANCE_USD = 0.5

/**
 * The remaining credit balance, in the header, as a way into the Usage tab.
 *
 * Reads the balance already in the settings query cache rather than fetching —
 * that query refetches on window focus, which is exactly when a stale balance
 * would be most misleading (a turn finished by the lifecycle cron with no
 * stream attached, the daily refill, a top-up in another tab).
 *
 * Always present for a signed-in user, including at zero and below — running
 * out is exactly when the number matters most. A null balance is not one
 * situation but three, which is what `creditsMode` disentangles: an uncapped
 * plan says "Unlimited", an account on its own keys says so, and only a logged
 * out visitor gets nothing, since there is no account to have a balance.
 */
export function CreditBalancePill({ compact = false }: { compact?: boolean }) {
  const modals = useModals()
  const { status } = useSession()
  const { data } = useSettingsQuery()
  const balanceUsd = data?.creditBalanceUsd
  const mode = data?.creditsMode

  if (status !== "authenticated") return null
  // Before the first real response there is nothing trustworthy to show, and a
  // flash of "$0.00" would read as "out of credits" to someone who isn't.
  if (mode === undefined && (balanceUsd === null || balanceUsd === undefined)) return null

  if (mode === "unlimited" || mode === "none") {
    const unlimited = mode === "unlimited"
    return (
      <PillButton
        compact={compact}
        tone="muted"
        icon={unlimited ? InfinityIcon : KeyRound}
        label={unlimited ? "Unlimited" : "Own keys"}
        title={
          unlimited
            ? "Your plan is uncapped — open Usage"
            : "Running on your own API keys, so credits aren't used — open Usage"
        }
        onClick={() => modals.openSettingsSection("usage")}
      />
    )
  }

  const value = balanceUsd ?? 0
  const isNegative = value < 0
  const isLow = !isNegative && value < LOW_BALANCE_USD

  return (
    <PillButton
      compact={compact}
      tone={isNegative ? "destructive" : isLow ? "warning" : "muted"}
      icon={isNegative || isLow ? TriangleAlert : undefined}
      label={`${isNegative ? "-" : ""}${fmtBalance(Math.abs(value))}`}
      title={
        isNegative
          ? "Your last turn ran past your balance — open Usage"
          : "Credits remaining — open Usage"
      }
      onClick={() => modals.openSettingsSection("usage")}
    />
  )
}

/** The pill's shell, so every state shares one set of metrics. */
function PillButton({
  compact,
  tone,
  icon: Icon,
  label,
  title,
  onClick,
}: {
  compact: boolean
  tone: "muted" | "warning" | "destructive"
  icon?: typeof TriangleAlert
  label: string
  title: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={`Credits remaining: ${label}. Open usage.`}
      className={cn(
        "flex shrink-0 items-center gap-1 rounded-md font-medium tabular-nums transition-colors cursor-pointer",
        compact ? "h-8 px-2 text-sm" : "h-7 px-2 text-xs",
        // Status colour only when the balance actually is a problem, and never
        // on its own — the icon and the title carry it too.
        tone === "destructive"
          ? "text-destructive hover:bg-destructive/10"
          : tone === "warning"
            ? "text-amber-600 hover:bg-accent dark:text-amber-500"
            : "text-muted-foreground hover:bg-accent hover:text-foreground"
      )}
    >
      {Icon && <Icon className="h-3.5 w-3.5 shrink-0" />}
      {label}
    </button>
  )
}
