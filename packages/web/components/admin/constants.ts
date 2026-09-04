import type { StatsPool, UsageProvider, UsageMetric } from "@/lib/query/hooks"
import { type StatsMetric } from "./charts/chartFormatters"

export const METRIC_OPTIONS: { key: StatsMetric; label: string }[] = [
  { key: "tokens", label: "Tokens" },
  { key: "cost", label: "Cost" },
  { key: "messages", label: "Messages" },
]

export const POOL_OPTIONS: { key: StatsPool; label: string; hint: string }[] = [
  { key: "shared", label: "Shared", hint: "Usage on our credential pools — what the platform pays for" },
  { key: "user", label: "Own key", hint: "Usage on credentials users supplied themselves — costs us nothing" },
  { key: "all", label: "All", hint: "Both pools combined" },
]

export const POOL_DISABLED_HINT =
  "Message counts come from the activity log, which has no credential-pool dimension. Switch to Tokens or Cost to filter by pool."

export const USAGE_PROVIDERS: { key: UsageProvider; label: string }[] = [
  { key: "claude", label: "Claude" },
  { key: "opencode", label: "OpenCode" },
  { key: "gemini", label: "Gemini" },
]

export const USAGE_METRICS: { key: UsageMetric; label: string }[] = [
  { key: "cost", label: "Cost" },
  { key: "tokens", label: "Tokens" },
]

export const COST_PROVIDERS: ReadonlySet<UsageProvider> = new Set<UsageProvider>([
  "opencode",
  "claude",
])

export const BILLED_PROVIDERS: ReadonlySet<UsageProvider> = new Set<UsageProvider>(["opencode"])
