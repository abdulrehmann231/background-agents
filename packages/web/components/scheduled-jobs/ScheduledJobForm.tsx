"use client"

import { useState, useEffect, useMemo } from "react"
import * as Dialog from "@radix-ui/react-dialog"
import { Clock, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { ModalHeader, focusChatPrompt } from "@/components/ui/modal-header"
import { RepoCombobox } from "@/components/chat/RepoCombobox"
import { BranchCombobox } from "@/components/chat/BranchCombobox"
import { McpServersCombobox } from "@/components/chat/McpServersCombobox"
import { ScheduleEditor } from "@/components/scheduled-jobs/ScheduleEditor"
import { WebhookUrlPanel } from "@/components/scheduled-jobs/WebhookUrlPanel"
import { AgentModelControls } from "@/components/scheduled-jobs/AgentModelControls"
import { type ScheduledJob } from "@/lib/scheduled-jobs/types"
import { agentModels, type Agent, NEW_REPOSITORY } from "@/lib/types"
import {
  getTimezoneName,
  localHourToUtc,
  inferIntervalMode,
  TRIGGER_TYPES,
  UNIT_MINUTES,
  type IntervalUnit,
} from "@/lib/scheduled-jobs/form-helpers"

// =============================================================================
// Types
// =============================================================================

interface ScheduledJobFormProps {
  open: boolean
  job?: ScheduledJob | null
  onClose: () => void
  onSuccess: (job: ScheduledJob) => void
  isMobile?: boolean
}

// =============================================================================
// Component
// =============================================================================

export function ScheduledJobForm({ open, job, onClose, onSuccess, isMobile = false }: ScheduledJobFormProps) {
  const isEditing = !!job

  // Form state
  const [name, setName] = useState(job?.name ?? "")
  const [prompt, setPrompt] = useState(job?.prompt ?? "")
  // Empty string means "no repo" in form state; on submit we send NEW_REPOSITORY.
  const [repo, setRepo] = useState(
    job?.repo && job.repo !== NEW_REPOSITORY ? job.repo : ""
  )
  const [baseBranch, setBaseBranch] = useState(job?.baseBranch ?? "main")
  const isRepoLess = !repo
  const [agent, setAgent] = useState<Agent>((job?.agent as Agent) ?? "opencode")
  const [model, setModel] = useState(job?.model ?? "")
  const [triggerType, setTriggerType] = useState<"interval" | "incoming">(job?.triggerType ?? "interval")
  const initialIntervalMode = inferIntervalMode(job?.intervalMinutes ?? 1440)
  const [intervalMinutes, setIntervalMinutes] = useState(initialIntervalMode.intervalMinutes)
  const [isCustomInterval, setIsCustomInterval] = useState(initialIntervalMode.isCustom)
  const [customIntervalValue, setCustomIntervalValue] = useState(initialIntervalMode.customValue)
  const [customIntervalUnit, setCustomIntervalUnit] = useState<IntervalUnit>(initialIntervalMode.customUnit)
  const [runAtHourLocal, setRunAtHourLocal] = useState(9) // Local time, default to 9 AM
  const [runAtDay, setRunAtDay] = useState(1) // Default to Monday
  const [autoPR, setAutoPR] = useState(job?.autoPR ?? true)
  const [continueFromLastRun, setContinueFromLastRun] = useState(job?.continueFromLastRun ?? false)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // In create mode, the form may "materialize" the job into the DB the first
  // time the user clicks the MCP picker, so MCP server connections have a real
  // job id to hang off of. If the user then cancels, we DELETE the row so we
  // don't leave a half-configured job behind. On final submit this id is what
  // we PATCH (instead of POSTing again).
  // Materialized rows are created with enabled: false so the cron doesn't pick
  // them up before the user finishes; the final submit flips enabled back on.
  const [materializedJobId, setMaterializedJobId] = useState<string | null>(null)

  // Incoming-webhook URL state. The token comes from the saved job and can be
  // swapped out via the rotate-token endpoint without closing the modal.
  const [incomingToken, setIncomingToken] = useState<string | null>(job?.incomingToken ?? null)
  const [copiedUrl, setCopiedUrl] = useState(false)
  const [rotating, setRotating] = useState(false)

  // Get timezone name for display
  const timezoneName = useMemo(() => getTimezoneName(), [])

  // What we actually send to the API (preset value, or custom value × unit).
  const effectiveIntervalMinutes = isCustomInterval
    ? Math.max(1, Math.floor(customIntervalValue || 0) * UNIT_MINUTES[customIntervalUnit])
    : intervalMinutes

  // Which Options-section toggles apply. The "continue" toggle is interval-only;
  // auto-PR needs a repo to push to. The section header renders only when at
  // least one applies — these same flags gate both the header and the toggles
  // so they can't drift apart.
  const showContinueOption = triggerType === "interval"
  const showAutoPROption = !isRepoLess
  const hasOptions = showContinueOption || showAutoPROption

  // Reset form state when job prop changes or modal opens
  useEffect(() => {
    if (open) {
      const initialAgent = (job?.agent as Agent) ?? "opencode"
      const initialModels = agentModels[initialAgent] ?? []
      setName(job?.name ?? "")
      setPrompt(job?.prompt ?? "")
      setRepo(job?.repo && job.repo !== NEW_REPOSITORY ? job.repo : "")
      setBaseBranch(job?.baseBranch ?? "main")
      setAgent(initialAgent)
      setModel(job?.model ?? initialModels[0]?.value ?? "")
      setTriggerType(job?.triggerType ?? "interval")
      const mode = inferIntervalMode(job?.intervalMinutes ?? 1440)
      setIntervalMinutes(mode.intervalMinutes)
      setIsCustomInterval(mode.isCustom)
      setCustomIntervalValue(mode.customValue)
      setCustomIntervalUnit(mode.customUnit)
      setRunAtHourLocal(9)
      setRunAtDay(1)
      setAutoPR(job?.autoPR ?? true)
      setContinueFromLastRun(job?.continueFromLastRun ?? false)
      setError(null)
      setMaterializedJobId(null)
      setIncomingToken(job?.incomingToken ?? null)
      setCopiedUrl(false)
      setRotating(false)
    }
  }, [open, job])

  // Update model when agent changes
  useEffect(() => {
    const models = agentModels[agent] ?? []
    if (models.length > 0 && !models.find(m => m.value === model)) {
      setModel(models[0].value)
    }
  }, [agent, model])

  useEffect(() => {
    if (triggerType === "incoming" && !incomingToken) {
      setIncomingToken(crypto.randomUUID())
    }
  }, [triggerType, incomingToken])

  /**
   * Build the request body for create/update from current form state.
   * Returns `null` and sets the visible error if required fields are missing.
   */
  function buildPayload(): Record<string, unknown> | null {
    if (!name.trim()) {
      setError("Name is required")
      return null
    }
    if (!prompt.trim()) {
      setError("Prompt is required")
      return null
    }
    if (triggerType === "interval" && effectiveIntervalMinutes < 10) {
      setError("Interval must be at least 10 minutes")
      return null
    }
    const runAtHourUtc = localHourToUtc(runAtHourLocal)
    return {
      name: name.trim(),
      prompt: prompt.trim(),
      // Empty form value means repo-less; send the NEW_REPOSITORY sentinel so
      // the backend can route through its existing no-clone sandbox path.
      repo: repo || NEW_REPOSITORY,
      baseBranch,
      agent,
      model: model || null,
      triggerType,
      intervalMinutes: triggerType === "interval" ? effectiveIntervalMinutes : undefined,
      runAtHour: triggerType === "interval" && effectiveIntervalMinutes >= 1440 ? runAtHourUtc : undefined,
      runAtDay: triggerType === "interval" && effectiveIntervalMinutes === 10080 ? runAtDay : undefined,
      // Auto-PR has nothing to push to in repo-less mode.
      autoPR: isRepoLess ? false : autoPR,
      continueFromLastRun,
    }
  }

  /**
   * Materialize callback for the MCP picker — fired on the first MCP click
   * during create mode. POSTs the job (with enabled: false so the cron won't
   * pick it up mid-config) and returns the new id to the picker. Uses
   * placeholders for name/prompt if the user hasn't typed them yet; the
   * final-submit validation in handleSubmit enforces real values before the
   * row goes live. The form stays open and continues acting like create mode
   * until the user hits "Create" (PATCH to flip enabled on) or "Cancel"
   * (DELETE the row).
   *
   * Works for both interval and incoming triggers — the POST mints an
   * incomingToken regardless, so the URL panel can render immediately for
   * incoming-typed drafts. If the user flips the trigger pill after
   * materialize, the final-submit PATCH carries the new triggerType.
   */
  async function materializeJob(_draftId: string): Promise<string | null> {
    setError(null)
    try {
      const res = await fetch("/api/scheduled-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Placeholders only exist on disk while isDraft = true. They're never
          // shown in the UI list (the GET filters drafts out) and the cron
          // skips drafts. The final submit PATCH replaces them with real
          // values before flipping isDraft to false.
          name: name.trim() || "(draft)",
          prompt: prompt.trim() || "(draft)",
          // Drafts default to the repo-less sentinel so the row passes the
          // backend's repo check before the user fills the form in fully.
          repo: repo || NEW_REPOSITORY,
          baseBranch: baseBranch || "main",
          agent,
          model: model || null,
          triggerType,
          // Carry the client-minted token (if any) so the persisted URL matches
          // what the panel is already showing. Null on interval drafts — the
          // server mints a dormant one.
          incomingToken: incomingToken ?? undefined,
          // intervalMinutes is required by the POST for "interval" — pass a
          // safe placeholder for incoming drafts so the validator doesn't
          // reject. Final submit overrides whichever value matters.
          intervalMinutes:
            triggerType === "interval" ? effectiveIntervalMinutes : 10,
          autoPR,
          continueFromLastRun,
          enabled: false,
          isDraft: true,
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        setError(data.error || "Failed to save job")
        return null
      }
      const created = await res.json()
      setMaterializedJobId(created.id)
      // Capture the token minted by POST so the URL panel can render the
      // moment the user flips to "Via webhook".
      if (created.incomingToken) {
        setIncomingToken(created.incomingToken)
      }
      return created.id
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save job")
      return null
    }
  }

  // Handle form submit
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    const payload = buildPayload()
    if (!payload) return

    setLoading(true)

    try {
      const targetId = materializedJobId ?? job?.id
      const isUpdate = !!targetId
      const url = isUpdate
        ? `/api/scheduled-jobs/${targetId}`
        : "/api/scheduled-jobs"
      const method = isUpdate ? "PATCH" : "POST"

      // For materialized rows we created with enabled: false + isDraft: true;
      // promote both on final Create. For real edits, we leave existing state
      // alone.
      // Persist the client-minted token on every create path so the saved URL
      // matches what the panel shows — including after a pre-save rotate. Edits
      // leave the token alone (rotation there goes through the server endpoint).
      const body =
        materializedJobId && !isEditing
          ? { ...payload, enabled: true, isDraft: false, incomingToken: incomingToken ?? undefined }
          : isUpdate
            ? payload
            : { ...payload, incomingToken: incomingToken ?? undefined }

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Failed to save job")
      }

      const savedJob = await res.json()
      // Clear the materialized marker so the close handler doesn't try to
      // delete what we just successfully saved.
      setMaterializedJobId(null)
      onSuccess(savedJob)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save job")
    } finally {
      setLoading(false)
    }
  }

  /**
   * Close handler: if we materialized a job in create mode and the user is
   * walking away without saving, drop the row so we don't leak draft jobs.
   * Best-effort — even if cleanup fails we still close the modal.
   */
  const handleClose = async () => {
    if (materializedJobId && !isEditing) {
      const idToDelete = materializedJobId
      setMaterializedJobId(null)
      try {
        await fetch(`/api/scheduled-jobs/${idToDelete}`, { method: "DELETE" })
      } catch (err) {
        console.error("[ScheduledJobForm] cleanup delete failed:", err)
      }
    }
    onClose()
  }

  /**
   * Build the URL the user pastes into their external app. Browser-only —
   * SSR returns an empty string and the panel hides the value until hydration.
   */
  const incomingWebhookUrl = useMemo(() => {
    if (!incomingToken) return ""
    if (typeof window === "undefined") return ""
    return `${window.location.origin}/wh/${incomingToken}`
  }, [incomingToken])

  const handleCopyUrl = async () => {
    if (!incomingWebhookUrl) return
    try {
      await navigator.clipboard.writeText(incomingWebhookUrl)
      setCopiedUrl(true)
      setTimeout(() => setCopiedUrl(false), 1500)
    } catch (err) {
      console.error("[ScheduledJobForm] copy failed:", err)
    }
  }

  const handleRotateToken = async () => {
    // Create mode: the URL hasn't been handed out anywhere yet, so "rotate" is
    // just minting a fresh client-side UUID. No server round-trip, no confirm —
    // the new token is persisted on save (create POST / final PATCH carry it).
    if (!isEditing) {
      setIncomingToken(crypto.randomUUID())
      return
    }
    // Edit mode: the URL is live (the user may have wired it into an external
    // app), so rotate server-side to invalidate the old one immediately.
    const targetId = job?.id
    if (!targetId) return
    if (!confirm("Rotating will invalidate the existing webhook URL. Continue?")) return
    setRotating(true)
    setError(null)
    try {
      const res = await fetch(`/api/scheduled-jobs/${targetId}/rotate-token`, {
        method: "POST",
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || "Failed to rotate token")
      }
      const updated = await res.json()
      setIncomingToken(updated.incomingToken ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rotate token")
    } finally {
      setRotating(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
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
                {isEditing ? "Edit Scheduled Agent" : "New Scheduled Agent"}
              </>
            }
          />

          {/* Form */}
          <form id="scheduled-job-form" onSubmit={handleSubmit} className="p-4 space-y-4 overflow-y-auto flex-1">
            {error && (
              <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}

            {/* Name */}
            <div>
              <label className="block text-sm font-medium mb-1">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
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
                    onClick={() => setTriggerType(t.value)}
                    className={cn(
                      "px-3 py-1 text-sm rounded-md transition-colors cursor-pointer",
                      triggerType === t.value
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
            {triggerType === "interval" && (
              <ScheduleEditor
                intervalMinutes={intervalMinutes}
                isCustomInterval={isCustomInterval}
                customIntervalValue={customIntervalValue}
                customIntervalUnit={customIntervalUnit}
                runAtDay={runAtDay}
                runAtHourLocal={runAtHourLocal}
                effectiveIntervalMinutes={effectiveIntervalMinutes}
                timezoneName={timezoneName}
                setIntervalMinutes={setIntervalMinutes}
                setIsCustomInterval={setIsCustomInterval}
                setCustomIntervalValue={setCustomIntervalValue}
                setCustomIntervalUnit={setCustomIntervalUnit}
                setRunAtDay={setRunAtDay}
                setRunAtHourLocal={setRunAtHourLocal}
              />
            )}

            {/* Incoming webhook URL panel — shown only for incoming triggers. */}
            {triggerType === "incoming" && (
              <WebhookUrlPanel
                token={incomingToken}
                url={incomingWebhookUrl}
                copied={copiedUrl}
                rotating={rotating}
                onCopy={handleCopyUrl}
                onRotate={handleRotateToken}
              />
            )}

            {/* Prompt Field - styled like ChatInput */}
            <div>
              <label className="block text-sm font-medium mb-1">Prompt</label>
              <div className={cn(
                "relative flex flex-col border shadow-sm bg-card border-border",
                isMobile ? "rounded-xl" : "rounded-2xl",
                "focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20"
              )}>
                {/* Textarea */}
                <div className={cn(isMobile ? "px-3 py-2" : "px-4 py-3")}>
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="What should the agent do?"
                    rows={4}
                    className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none resize-none"
                  />
                </div>

                {/* Bottom bar with selectors. The container wrappers mirror
                    ChatInput so the inner pickers can reveal labels and counts
                    at the right widths via container queries. */}
                <div className={cn(
                  "@container flex items-center",
                  isMobile ? "gap-2 px-3 py-2" : "gap-3 px-4 py-2"
                )}>
                  {/* Left side items (repo / branch / MCP) */}
                  <div className={cn(
                    "flex items-center gap-2",
                    isMobile ? "w-full @container/row1" : "flex-1"
                  )}>
                    {/* Repo selector */}
                    <RepoCombobox
                      value={repo || null}
                      onChange={(newRepo, defaultBranch) => {
                        setRepo(newRepo)
                        setBaseBranch(defaultBranch)
                      }}
                      disabled={isEditing}
                      isMobile={isMobile}
                      showLabel
                    />

                    {/* Clear-repo X — only in create mode; edits keep the
                        repo immutable since the sandbox/branch pipeline is
                        already wired to it. */}
                    {repo && !isEditing && (
                      <button
                        type="button"
                        onClick={() => {
                          setRepo("")
                          setBaseBranch("main")
                        }}
                        className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer p-0.5"
                        title="Remove repository"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}

                    {/* Branch selector — only meaningful when a repo is set. */}
                    {repo && (
                      <BranchCombobox
                        repo={repo}
                        value={baseBranch}
                        onChange={setBaseBranch}
                        defaultBranch={baseBranch}
                        isMobile={isMobile}
                        showLabel
                      />
                    )}

                    {/* MCP servers picker — inline alongside repo/branch like
                        the chat input. In create mode the first click
                        materializes the job so the picker has a real id;
                        cancel cleans up. */}
                    <McpServersCombobox
                      entityId={materializedJobId ?? job?.id ?? "draft"}
                      apiBase="/api/scheduled-jobs"
                      isDraft={!isEditing && !materializedJobId}
                      onMaterializeDraft={materializeJob}
                      isMobile={isMobile}
                    />
                  </div>

                  {/* Spacer */}
                  <div className="flex-1" />

                  {/* Agent + model pickers */}
                  <AgentModelControls
                    agent={agent}
                    model={model}
                    onAgentChange={setAgent}
                    onModelChange={setModel}
                  />
                </div>
              </div>
            </div>

            {/* Options Section — hidden when neither option applies (e.g. an
                incoming, repo-less job has neither the interval-only
                "continue" toggle nor the repo-only auto-PR toggle). */}
            {hasOptions && (
            <div>
              <label className="block text-sm font-medium mb-2">Options</label>
              <div className="space-y-2">
                {/* Continue from last run — same checkbox in both modes, but
                    the backend interprets it differently: with a repo it
                    reuses the prior branch; repo-less it prepends the prior
                    run's final output as prompt context. */}
                {showContinueOption && (
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="continueFromLastRun"
                      checked={continueFromLastRun}
                      onChange={(e) => setContinueFromLastRun(e.target.checked)}
                      className="h-4 w-4 rounded border-border"
                    />
                    <label htmlFor="continueFromLastRun" className="text-sm">
                      {isRepoLess
                        ? "Include the previous run's output as context"
                        : "Include commits from the previous run"}
                    </label>
                  </div>
                )}

                {/* Auto-PR has no target in repo-less mode (no remote to push to). */}
                {showAutoPROption && (
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="autoPR"
                      checked={autoPR}
                      onChange={(e) => setAutoPR(e.target.checked)}
                      className="h-4 w-4 rounded border-border"
                    />
                    <label htmlFor="autoPR" className="text-sm">
                      Automatically create PR when there are new commits
                    </label>
                  </div>
                )}
              </div>
            </div>
            )}

          </form>

          {/* Actions - fixed at bottom */}
          <div className="flex justify-end gap-2 px-4 py-3 border-t border-border flex-shrink-0">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 text-sm rounded-md hover:bg-accent transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="scheduled-job-form"
              disabled={loading}
              className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors cursor-pointer"
            >
              {loading ? "Saving..." : isEditing ? "Save Changes" : "Create"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
