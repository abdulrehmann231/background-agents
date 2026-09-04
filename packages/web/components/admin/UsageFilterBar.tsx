"use client"

import { cn } from "@/lib/utils"
import type { UsageProvider, UsageMetric } from "@/lib/query/hooks"
import { USAGE_METRICS, USAGE_PROVIDERS } from "./constants"

interface UsageFilterBarProps {
  costSupported: boolean
  effectiveUsageMetric: UsageMetric
  onUsageMetricChange: (metric: UsageMetric) => void
  usageProvider: UsageProvider
  onUsageProviderChange: (provider: UsageProvider) => void
}

export function UsageFilterBar({
  costSupported,
  effectiveUsageMetric,
  onUsageMetricChange,
  usageProvider,
  onUsageProviderChange,
}: UsageFilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 sm:gap-3">
      {costSupported && (
        <div className="flex gap-1 rounded-lg bg-muted p-1">
          {USAGE_METRICS.map((option) => (
            <button
              key={option.key}
              onClick={() => onUsageMetricChange(option.key)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition-all sm:px-4 sm:text-sm",
                effectiveUsageMetric === option.key
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
      <div className="flex gap-1 rounded-lg bg-muted p-1">
        {USAGE_PROVIDERS.map((option) => (
          <button
            key={option.key}
            onClick={() => onUsageProviderChange(option.key)}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-medium transition-all sm:px-4 sm:text-sm",
              usageProvider === option.key
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}
