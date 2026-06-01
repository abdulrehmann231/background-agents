// =============================================================================
// Static option lists for the scheduled-job form
// =============================================================================

import type { Agent } from "@/lib/types"

export const TRIGGER_TYPES = [
  {
    label: "On a schedule",
    value: "interval",
    description: "Run at regular intervals"
  },
  {
    label: "Via webhook",
    value: "incoming",
    description: "Triggered by any external app (GitHub, Jira, Slack, Linear, …) — paste the generated URL into the source app"
  },
] as const

export const DAYS_OF_WEEK = [
  { label: "Monday", value: 1 },
  { label: "Tuesday", value: 2 },
  { label: "Wednesday", value: 3 },
  { label: "Thursday", value: 4 },
  { label: "Friday", value: 5 },
  { label: "Saturday", value: 6 },
  { label: "Sunday", value: 0 },
]

export const TIME_OPTIONS = [
  { label: "12:00 AM", value: 0 },
  { label: "1:00 AM", value: 1 },
  { label: "2:00 AM", value: 2 },
  { label: "3:00 AM", value: 3 },
  { label: "4:00 AM", value: 4 },
  { label: "5:00 AM", value: 5 },
  { label: "6:00 AM", value: 6 },
  { label: "7:00 AM", value: 7 },
  { label: "8:00 AM", value: 8 },
  { label: "9:00 AM", value: 9 },
  { label: "10:00 AM", value: 10 },
  { label: "11:00 AM", value: 11 },
  { label: "12:00 PM", value: 12 },
  { label: "1:00 PM", value: 13 },
  { label: "2:00 PM", value: 14 },
  { label: "3:00 PM", value: 15 },
  { label: "4:00 PM", value: 16 },
  { label: "5:00 PM", value: 17 },
  { label: "6:00 PM", value: 18 },
  { label: "7:00 PM", value: 19 },
  { label: "8:00 PM", value: 20 },
  { label: "9:00 PM", value: 21 },
  { label: "10:00 PM", value: 22 },
  { label: "11:00 PM", value: 23 },
]

export const AVAILABLE_AGENTS: Agent[] = ["opencode", "claude-code", "codex"]
