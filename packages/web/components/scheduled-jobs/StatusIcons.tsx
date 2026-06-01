"use client"

import { Clock, AlertCircle, Check, X, CheckCircle2, XCircle, Circle, RefreshCw } from "lucide-react"
import type { ScheduledJob } from "@/lib/scheduled-jobs/types"

/** Status glyph shown next to a job in the list view. */
export function getJobStatusIcon(job: ScheduledJob) {
  if (!job.enabled) {
    return <X className="h-3.5 w-3.5 text-muted-foreground" />
  }
  if (job.lastRun?.status === "error") {
    return <AlertCircle className="h-3.5 w-3.5 text-destructive" />
  }
  if (job.lastRun?.status === "completed") {
    return <Check className="h-3.5 w-3.5 text-green-500" />
  }
  if (job.lastRun?.status === "running") {
    return <Clock className="h-3.5 w-3.5 text-blue-500 animate-pulse" />
  }
  return <Clock className="h-3.5 w-3.5 text-muted-foreground" />
}

/** Status glyph shown next to an individual run in the detail view. */
export function getRunStatusIcon(status: string) {
  switch (status) {
    case "completed":
      return <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
    case "error":
      return <XCircle className="h-3.5 w-3.5 text-destructive" />
    case "running":
      return <RefreshCw className="h-3.5 w-3.5 text-blue-500 animate-spin" />
    default:
      return <Circle className="h-3.5 w-3.5 text-muted-foreground" />
  }
}
