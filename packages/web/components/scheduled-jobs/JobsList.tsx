"use client"

import { cn } from "@/lib/utils"
import { NEW_REPOSITORY } from "@/lib/types"
import type { ScheduledJob } from "@/lib/scheduled-jobs/types"
import { getRepoLabel, getLastRunText, getTriggerDescription } from "@/lib/scheduled-jobs/format"
import { getJobStatusIcon } from "./StatusIcons"
import { JobActionsMenu } from "./JobActionsMenu"

interface JobsListProps {
  jobs: ScheduledJob[]
  menuOpenId: string | null
  setMenuOpenId: (id: string | null) => void
  onSelect: (jobId: string, jobName: string) => void
  onEdit: (job: ScheduledJob) => void
  onRunNow: (job: ScheduledJob) => void
  onDelete: (job: ScheduledJob) => void
}

/**
 * Renders the saved jobs as mobile cards (small screens) and a desktop table.
 * Both layouts share the same row data, status icon, and overflow menu.
 */
export function JobsList({
  jobs,
  menuOpenId,
  setMenuOpenId,
  onSelect,
  onEdit,
  onRunNow,
  onDelete,
}: JobsListProps) {
  return (
    <>
      {/* Mobile Card Layout */}
      <div className="space-y-3 md:hidden">
        {jobs.map((job) => (
          <div
            key={job.id}
            className="rounded-lg border border-border bg-white/50 dark:bg-white/5 p-4 cursor-pointer"
            onClick={() => onSelect(job.id, job.name)}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                {getJobStatusIcon(job)}
                <span className={cn(
                  "text-sm font-medium truncate",
                  !job.enabled && "text-muted-foreground"
                )}>
                  {job.name}
                </span>
                {!job.enabled && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
                    Disabled
                  </span>
                )}
              </div>
              <JobActionsMenu
                job={job}
                isOpen={menuOpenId === job.id}
                onToggle={setMenuOpenId}
                onEdit={onEdit}
                onRunNow={onRunNow}
                onDelete={onDelete}
                className="shrink-0"
              />
            </div>
            <div className="mt-3 space-y-1.5 text-sm text-muted-foreground">
              <div className={cn("truncate", job.repo === NEW_REPOSITORY && "italic")}>{getRepoLabel(job.repo)}</div>
              <div className="flex items-center justify-between gap-2">
                <span>{getTriggerDescription(job)}</span>
                <span className={cn(
                  job.lastRun?.status === "error" && "text-destructive"
                )}>
                  {getLastRunText(job)}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Desktop Table Layout */}
      <div className="hidden md:block rounded-lg border border-border bg-background">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Name</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Repository</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Schedule</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Last run</th>
              <th className="px-4 py-2.5 w-10"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {jobs.map((job) => (
              <tr
                key={job.id}
                className="bg-white/50 dark:bg-white/5 cursor-pointer"
                onClick={() => onSelect(job.id, job.name)}
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    {getJobStatusIcon(job)}
                    <span className={cn(
                      "text-sm font-medium",
                      !job.enabled && "text-muted-foreground"
                    )}>
                      {job.name}
                    </span>
                    {!job.enabled && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                        Disabled
                      </span>
                    )}
                  </div>
                </td>
                <td className={cn(
                  "px-4 py-3 text-sm text-muted-foreground",
                  job.repo === NEW_REPOSITORY && "italic"
                )}>
                  {getRepoLabel(job.repo)}
                </td>
                <td className="px-4 py-3 text-sm text-muted-foreground">
                  {getTriggerDescription(job)}
                </td>
                <td className="px-4 py-3 text-sm text-muted-foreground">
                  <span className={cn(
                    job.lastRun?.status === "error" && "text-destructive"
                  )}>
                    {getLastRunText(job)}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <JobActionsMenu
                    job={job}
                    isOpen={menuOpenId === job.id}
                    onToggle={setMenuOpenId}
                    onEdit={onEdit}
                    onRunNow={onRunNow}
                    onDelete={onDelete}
                    className="inline-block"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
