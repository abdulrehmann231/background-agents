// =============================================================================
// Display formatters for scheduled jobs and their runs
// =============================================================================

import { format, formatDistanceToNow } from "date-fns"
import { NEW_REPOSITORY } from "@/lib/types"
import type { ScheduledJob, ScheduledJobRun } from "./types"

export function getRepoLabel(repo: string): string {
  return repo === NEW_REPOSITORY ? "No repository" : repo
}

export function getLastRunText(job: ScheduledJob): string {
  if (!job.lastRun) return "Never run"

  const timeAgo = formatDistanceToNow(job.lastRun.startedAt, { addSuffix: true })

  if (job.lastRun.status === "running") {
    return `Running ${timeAgo}`
  }
  if (job.lastRun.status === "error") {
    return `Failed ${timeAgo}`
  }
  if (job.lastRun.prUrl) {
    return `PR #${job.lastRun.prNumber} ${timeAgo}`
  }
  if (job.lastRun.status === "completed") {
    return `No changes ${timeAgo}`
  }
  return timeAgo
}

export function formatRunLabel(run: ScheduledJobRun): string {
  return format(run.startedAt, "MMM d, h:mm a")
}

export function formatDuration(startedAt: number, completedAt: number): string {
  const durationMs = completedAt - startedAt
  const seconds = Math.floor(durationMs / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (hours > 0) {
    const remainingMinutes = minutes % 60
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`
  }
  if (minutes > 0) {
    const remainingSeconds = seconds % 60
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`
  }
  return `${seconds}s`
}

export function getTriggerDescription(job: ScheduledJob): string {
  if (job.triggerType === "incoming") {
    return "Webhook"
  }
  // Interval trigger - show human-readable schedule
  const minutes = job.intervalMinutes
  if (minutes < 60) {
    return `Every ${minutes} minute${minutes === 1 ? "" : "s"}`
  }
  const hours = Math.round(minutes / 60)
  if (minutes < 1440) {
    return `Every ${hours} hour${hours === 1 ? "" : "s"}`
  }
  const days = Math.round(minutes / 1440)
  return `Every ${days} day${days === 1 ? "" : "s"}`
}
