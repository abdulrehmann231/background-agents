"use client"

interface JobOptionsTogglesProps {
  isRepoLess: boolean
  showContinueOption: boolean
  showAutoPROption: boolean
  continueFromLastRun: boolean
  setContinueFromLastRun: (value: boolean) => void
  autoPR: boolean
  setAutoPR: (value: boolean) => void
}

/**
 * The "Options" section: continue-from-last-run and auto-PR toggles. Each is
 * gated by its own flag, so the section renders nothing when neither applies
 * (e.g. an incoming, repo-less job). Render only when `hasOptions` is true.
 */
export function JobOptionsToggles({
  isRepoLess,
  showContinueOption,
  showAutoPROption,
  continueFromLastRun,
  setContinueFromLastRun,
  autoPR,
  setAutoPR,
}: JobOptionsTogglesProps) {
  return (
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
  )
}
