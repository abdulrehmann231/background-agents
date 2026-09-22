"use client"

import { TriangleAlert } from "lucide-react"
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
 * Renders nothing when there is no balance to show: logged out, or an account
 * the balance doesn't gate. An empty header slot is better than "$0.00" for
 * someone who has no balance because they never needed one.
 */
export function CreditBalancePill({ compact = false }: { compact?: boolean }) {
  const modals = useModals()
  const { data } = useSettingsQuery()
  const balanceUsd = data?.creditBalanceUsd

  if (balanceUsd === null || balanceUsd === undefined) return null

  const isNegative = balanceUsd < 0
  const isLow = !isNegative && balanceUsd < LOW_BALANCE_USD

  return (
    <button
      type="button"
      onClick={() => modals.openSettingsSection("usage")}
      title={
        isNegative
          ? "Your last turn ran past your balance — open Usage"
          : "Credits remaining — open Usage"
      }
      aria-label={`Credits remaining: ${fmtBalance(balanceUsd)}. Open usage.`}
      className={cn(
        "flex shrink-0 items-center gap-1 rounded-md font-medium tabular-nums transition-colors cursor-pointer",
        compact ? "h-8 px-2 text-sm" : "h-7 px-2 text-xs",
        // Status colour only when the balance actually is a problem, and never
        // on its own — the icon and the title carry it too.
        isNegative
          ? "text-destructive hover:bg-destructive/10"
          : isLow
            ? "text-amber-600 hover:bg-accent dark:text-amber-500"
            : "text-muted-foreground hover:bg-accent hover:text-foreground"
      )}
    >
      {(isNegative || isLow) && <TriangleAlert className="h-3.5 w-3.5 shrink-0" />}
      {isNegative && "-"}
      {fmtBalance(Math.abs(balanceUsd))}
    </button>
  )
}
