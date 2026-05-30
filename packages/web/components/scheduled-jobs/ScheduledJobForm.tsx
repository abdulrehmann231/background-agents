"use client"

import * as Dialog from "@radix-ui/react-dialog"
import { Clock } from "lucide-react"
import { cn } from "@/lib/utils"
import { ModalHeader, focusChatPrompt } from "@/components/ui/modal-header"
import { ScheduleEditor } from "@/components/scheduled-jobs/ScheduleEditor"
import { WebhookUrlPanel } from "@/components/scheduled-jobs/WebhookUrlPanel"
import { JobPromptField } from "@/components/scheduled-jobs/JobPromptField"
import { JobOptionsToggles } from "@/components/scheduled-jobs/JobOptionsToggles"
import { type ScheduledJob } from "@/lib/scheduled-jobs/types"
import { TRIGGER_TYPES } from "@/lib/scheduled-jobs/form-helpers"
import { useScheduledJobForm } from "@/lib/scheduled-jobs/use-scheduled-job-form"

interface ScheduledJobFormProps {
  open: boolean
  job?: ScheduledJob | null
  onClose: () => void
  onSuccess: (job: ScheduledJob) => void
  isMobile?: boolean
}

export function ScheduledJobForm({ open, job, onClose, onSuccess, isMobile = false }: ScheduledJobFormProps) {
  const form = useScheduledJobForm({ open, job, onClose, onSuccess })

  return (
    <Dialog.Root open={open} onOpenChange={(isOpen) => !isOpen && form.handleClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={cn(
          "fixed inset-0 z-50 transition-opacity duration-300 bg-black/15 backdrop-blur-[1px]",
          open ? "opacity-100" : "opacity-0"
        )} />
        <Dialog.Content
          onCloseAutoFocus={(e) => { e.preventDefault(); focusChatPrompt() }}
          className={cn(
            "fixed z-50 bg-popover overflow-hidden flex flex-col",
            isMobile
              ? "inset-x-4 top-1/2 -translate-y-1/2 rounded-xl max-h-[85vh]"
              : "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full border border-border rounded-lg shadow-xl max-h-[90vh]",
            !isMobile && "max-w-2xl"
          )}
        >
          <ModalHeader
            title={
              <>
                <Clock className="h-4 w-4" />
                {form.isEditing ? "Edit Scheduled Agent" : "New Scheduled Agent"}
              </>
            }
          />

          {/* Form */}
          <form id="scheduled-job-form" onSubmit={form.handleSubmit} className="p-4 space-y-4 overflow-y-auto flex-1">
            {form.error && (
              <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {form.error}
              </div>
            )}

            {/* Name */}
            <div>
              <label className="block text-sm font-medium mb-1">Name</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => form.setName(e.target.value)}
                placeholder="e.g., Dependency Updates"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            {/* Trigger Type - Segmented Control. Always editable — PATCH
                handles the swap for both still-open drafts and existing
                jobs. */}
            <div>
              <label className="block text-sm font-medium mb-2">Trigger</label>
              <div className="inline-flex rounded-md bg-muted p-0.5">
                {TRIGGER_TYPES.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => form.setTriggerType(t.value)}
                    className={cn(
                      "px-3 py-1 text-sm rounded-md transition-colors cursor-pointer",
                      form.triggerType === t.value
                        ? "bg-background shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Schedule - only for scheduled trigger */}
            {form.triggerType === "interval" && (
              <ScheduleEditor
                intervalMinutes={form.intervalMinutes}
                isCustomInterval={form.isCustomInterval}
                customIntervalValue={form.customIntervalValue}
                customIntervalUnit={form.customIntervalUnit}
                runAtDay={form.runAtDay}
                runAtHourLocal={form.runAtHourLocal}
                effectiveIntervalMinutes={form.effectiveIntervalMinutes}
                timezoneName={form.timezoneName}
                setIntervalMinutes={form.setIntervalMinutes}
                setIsCustomInterval={form.setIsCustomInterval}
                setCustomIntervalValue={form.setCustomIntervalValue}
                setCustomIntervalUnit={form.setCustomIntervalUnit}
                setRunAtDay={form.setRunAtDay}
                setRunAtHourLocal={form.setRunAtHourLocal}
              />
            )}

            {/* Incoming webhook URL panel — shown only for incoming triggers. */}
            {form.triggerType === "incoming" && (
              <WebhookUrlPanel
                token={form.incomingToken}
                url={form.incomingWebhookUrl}
                copied={form.copiedUrl}
                rotating={form.rotating}
                onCopy={form.handleCopyUrl}
                onRotate={form.handleRotateToken}
              />
            )}

            {/* Prompt + repo/branch/MCP + agent/model bar */}
            <JobPromptField
              prompt={form.prompt}
              onPromptChange={form.setPrompt}
              repo={form.repo}
              setRepo={form.setRepo}
              baseBranch={form.baseBranch}
              setBaseBranch={form.setBaseBranch}
              isEditing={form.isEditing}
              mcpEntityId={form.materializedJobId ?? job?.id ?? "draft"}
              mcpIsDraft={!form.isEditing && !form.materializedJobId}
              onMaterializeDraft={form.materializeJob}
              agent={form.agent}
              model={form.model}
              onAgentChange={form.setAgent}
              onModelChange={form.setModel}
              isMobile={isMobile}
            />

            {/* Options Section — hidden when neither option applies (e.g. an
                incoming, repo-less job has neither the interval-only
                "continue" toggle nor the repo-only auto-PR toggle). */}
            {form.hasOptions && (
              <JobOptionsToggles
                isRepoLess={form.isRepoLess}
                showContinueOption={form.showContinueOption}
                showAutoPROption={form.showAutoPROption}
                continueFromLastRun={form.continueFromLastRun}
                setContinueFromLastRun={form.setContinueFromLastRun}
                autoPR={form.autoPR}
                setAutoPR={form.setAutoPR}
              />
            )}

          </form>

          {/* Actions - fixed at bottom */}
          <div className="flex justify-end gap-2 px-4 py-3 border-t border-border flex-shrink-0">
            <button
              type="button"
              onClick={form.handleClose}
              className="px-4 py-2 text-sm rounded-md hover:bg-accent transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="scheduled-job-form"
              disabled={form.loading}
              className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors cursor-pointer"
            >
              {form.loading ? "Saving..." : form.isEditing ? "Save Changes" : "Create"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
