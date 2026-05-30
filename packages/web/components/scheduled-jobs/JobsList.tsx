"use client"

import { Clock, Plus } from "lucide-react"
import { cn } from "@/lib/utils"
import { JobActionsMenu } from "@/components/scheduled-jobs/JobActionsMenu"
import { type ScheduledJob } from "@/lib/scheduled-jobs/types"
import { NEW_REPOSITORY } from "@/lib/types"
import {
  getRepoLabel,
  getJobStatusIcon,
  getLastRunText,
  getTriggerDescription,
} from "@/lib/scheduled-jobs/view-helpers"

interface JobsListProps {
  jobs: ScheduledJob[]
  error: string | null
  onCreate: () => void
  onSelect: (jobId: string, jobName: string) => void
  onEdit: (job: ScheduledJob) => void
  onRunNow: (job: ScheduledJob) => void
  onDelete: (job: ScheduledJob) => void
}

/** The Scheduled Agents list: header, empty state, and mobile/desktop layouts. */
export function JobsList({ jobs, error, onCreate, onSelect, onEdit, onRunNow, onDelete }: JobsListProps) {
  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* List Header - styled like chat header */}
      <div className="flex items-center justify-between pt-3 shrink-0" style={{ paddingLeft: "1.625rem", paddingRight: "1.625rem" }}>
        <div className="flex items-center gap-2">
          <span className="flex h-7 items-center text-sm font-medium text-foreground px-2 rounded-md hover:bg-accent transition-colors cursor-default">
            Scheduled Agents
          </span>
        </div>
        <button
          onClick={onCreate}
          className="flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Plus className="h-4 w-4" />
          New Job
        </button>
      </div>

      {/* List Content */}
      <main className="flex-1 overflow-auto p-6">
        {error && (
          <div className="mb-4 rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {jobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 pt-24 text-center">
            <Clock className="h-6 w-6 text-muted-foreground/50 mb-4" />
            <p className="text-sm text-muted-foreground mt-1">
              Create a scheduled job to run agents automatically
            </p>
          </div>
        ) : (
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
                      onEdit={onEdit}
                      onRunNow={onRunNow}
                      onDelete={onDelete}
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
                          onEdit={onEdit}
                          onRunNow={onRunNow}
                          onDelete={onDelete}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
