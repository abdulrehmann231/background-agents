"use client"

interface JobOptionsProps {
  isRepoLess: boolean
  showContinueOption: boolean
  showAutoPROption: boolean
  continueFromLastRun: boolean
  setContinueFromLastRun: (v: boolean) => void
  autoPR: boolean
  setAutoPR: (v: boolean) => void
}

/**
 * The "Options" toggles. "Continue from last run" is interval-only; auto-PR
 * needs a repo to push to. The caller only renders this section when at least
 * one toggle applies.
 */
export function JobOptions({
  isRepoLess,
  showContinueOption,
  showAutoPROption,
  continueFromLastRun,
  setContinueFromLastRun,
  autoPR,
  setAutoPR,
}: JobOptionsProps) {
  return (
    <div>
      <label className="block text-sm font-medium mb-2">Options</label>
      <div className="space-y-2">
        {/* Continue from last run — same checkbox in both modes, but the
            backend interprets it differently: with a repo it reuses the prior
            branch; repo-less it prepends the prior run's final output as
            prompt context. */}
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
  )
}
