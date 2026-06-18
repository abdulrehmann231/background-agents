/**
 * Auto-pull a chat's branch before an agent run.
 *
 * A chat is tied to a git branch living in a Daytona sandbox. The agent only
 * pushes at the *end* of a turn, so commits pushed to the branch from elsewhere
 * (a local checkout, another chat, the GitHub UI) are invisible to the sandbox
 * until we pull them in. This helper fetches the branch and, when the sandbox is
 * behind origin, merges the remote commits before the agent starts.
 *
 * Conflict handling is driven by `mode` (chosen by the user via the pull-conflict
 * dialog). See {@link AutoPullResult} for the per-mode outcomes.
 *
 * The git plumbing mirrors the merge/rebase conflict detection already used in
 * `app/api/sandbox/git/route.ts` and the `isInConflictState` check in
 * `app/api/agent/stream/route.ts`.
 */

import { createSandboxGit, type SandboxLike } from "@background-agents/daytona-git"

export type AutoPullResult =
  /** Nothing to do — branch already matches origin. */
  | { status: "up-to-date" }
  /** Remote commits were merged cleanly. `commits` = how many were behind. */
  | { status: "pulled"; commits: number }
  /**
   * A merge is **in progress** with conflicts. The sandbox is left in exactly
   * the same state as a conflicted merge/rebase, so the existing conflict UI
   * (`check-rebase-status` → header indicator + Abort Merge) picks it up.
   *
   * `alreadyInProgress` distinguishes the two callers:
   * - `false` — *this* call started the merge and it conflicted. The route
   *   blocks the run and surfaces the conflict so the user can decide.
   * - `true` — a merge from a prior conflicted pull was still in progress when
   *   the user sent another message. The route lets the agent run (on the
   *   conflicted tree) so it can resolve the conflict as part of the turn.
   */
  | { status: "conflict"; conflictedFiles: string[]; alreadyInProgress: boolean }
  /**
   * The pull could not be applied for a reason that isn't a content conflict
   * (e.g. a `git` error). The agent runs on the un-pulled tree; the end-of-turn
   * push then surfaces the divergence. `message` is the raw git output.
   */
  | { status: "error"; message: string }

/** Quote a shell argument to prevent injection (matches commands.ts `esc`). */
function esc(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`
}

/** Whether a merge is currently in progress in the repo. */
async function isMergeInProgress(
  sandbox: SandboxLike,
  repoPath: string
): Promise<boolean> {
  const check = await sandbox.process.executeCommand(
    `test -f ${esc(repoPath)}/.git/MERGE_HEAD && echo "yes" || echo "no"`
  )
  return check.result.trim() === "yes"
}

/** List the files with unresolved merge conflicts. */
async function conflictedFiles(
  sandbox: SandboxLike,
  repoPath: string
): Promise<string[]> {
  const res = await sandbox.process.executeCommand(
    `cd ${esc(repoPath)} && git diff --name-only --diff-filter=U 2>&1`
  )
  return res.result.trim().split("\n").filter(Boolean)
}

/** Short SHA of the current HEAD (empty string if it can't be read). */
async function head(sandbox: SandboxLike, repoPath: string): Promise<string> {
  const res = await sandbox.process.executeCommand(
    `cd ${esc(repoPath)} && git rev-parse --short HEAD 2>/dev/null || echo ""`
  )
  return res.result.trim()
}

/** Porcelain status output — empty when the working tree is clean. */
async function dirtyStatus(sandbox: SandboxLike, repoPath: string): Promise<string> {
  const res = await sandbox.process.executeCommand(
    `cd ${esc(repoPath)} && git status --porcelain 2>&1`
  )
  return res.result.trim()
}

/** Number of commits the local branch is behind origin/<branch>. */
async function commitsBehind(
  sandbox: SandboxLike,
  repoPath: string,
  branch: string
): Promise<number> {
  // left = commits in origin/<branch> not in HEAD (behind); right = ahead.
  const res = await sandbox.process.executeCommand(
    `cd ${esc(repoPath)} && git rev-list --left-right --count origin/${esc(branch)}...HEAD 2>/dev/null || echo "0 0"`
  )
  const behind = parseInt(res.result.trim().split(/\s+/)[0] || "0", 10)
  return Number.isNaN(behind) ? 0 : behind
}

/**
 * Merge origin/<branch> into the current branch.
 *
 * `--autostash` is used so uncommitted changes in the working tree (e.g. the
 * agent's WIP from a prior turn) don't block a fast-forward — git stashes them,
 * merges, then re-applies. The outcome is decided authoritatively:
 *   - unresolved conflicts present  → "conflict" (merge left in progress)
 *   - HEAD did not advance, no conflict → "error" (the merge failed; we don't
 *     pretend it pulled)
 *   - HEAD advanced                 → "pulled"
 */
async function mergeRemote(
  sandbox: SandboxLike,
  repoPath: string,
  branch: string,
  behind: number
): Promise<AutoPullResult> {
  const before = await head(sandbox, repoPath)
  const dirty = await dirtyStatus(sandbox, repoPath)
  if (dirty) {
    console.log(`[auto-pull] working tree is DIRTY before merge:\n${dirty}`)
  } else {
    console.log(`[auto-pull] working tree is clean before merge`)
  }

  const mergeRes = await sandbox.process.executeCommand(
    `cd ${esc(repoPath)} && git merge --no-edit --autostash origin/${esc(branch)} 2>&1`
  )
  const after = await head(sandbox, repoPath)
  console.log(
    `[auto-pull] git merge exit=${mergeRes.exitCode}, HEAD ${before || "?"} -> ${after || "?"}\n${mergeRes.result.trim()}`
  )

  // Conflicts (from the merge itself or from re-applying the autostash) leave
  // unmerged paths in the index.
  const conflicts = await conflictedFiles(sandbox, repoPath)
  if (conflicts.length > 0 || (await isMergeInProgress(sandbox, repoPath))) {
    return { status: "conflict", conflictedFiles: conflicts, alreadyInProgress: false }
  }

  // No conflict but HEAD didn't move → the merge did not apply. Report it
  // honestly instead of claiming a successful pull.
  if (after === before || mergeRes.exitCode !== 0) {
    return { status: "error", message: mergeRes.result.trim() || "merge did not advance HEAD" }
  }

  return { status: "pulled", commits: behind }
}

/**
 * Pull origin/<branch> into the sandbox before the agent runs.
 *
 * - If a merge is **already in progress** (a prior pull conflicted and the user
 *   is now sending a message to resolve it), report its conflicts with
 *   `alreadyInProgress: true` so the route lets the agent resolve them. We don't
 *   re-fetch or re-merge.
 * - Otherwise fetch origin/<branch>; if behind, merge. A clean merge → `pulled`;
 *   a conflict is left in progress with `alreadyInProgress: false` so the route
 *   blocks the run and surfaces the existing conflict UI.
 *
 * Aborting a conflicted pull is handled by the existing `abort-merge` git action
 * (the header "Abort Merge" button), not here.
 *
 * The caller is responsible for guarding callers that shouldn't pull at all
 * (freshly created sandbox, no remote branch, no GitHub token).
 */
export async function autoPullBeforeRun(
  sandbox: SandboxLike,
  repoPath: string,
  branch: string,
  token: string
): Promise<AutoPullResult> {
  console.log(`[auto-pull] start: branch=${branch} repo=${repoPath}`)

  // A merge left in progress by a prior conflicted pull — the user is sending a
  // message to have the agent resolve it. Surface the conflicts as-is; the agent
  // runs on the conflicted tree.
  if (await isMergeInProgress(sandbox, repoPath)) {
    const files = await conflictedFiles(sandbox, repoPath)
    console.log(
      `[auto-pull] merge already in progress, ${files.length} conflicted file(s): ${files.join(", ") || "(none)"} — agent will resolve`
    )
    return { status: "conflict", conflictedFiles: files, alreadyInProgress: true }
  }

  const git = createSandboxGit(sandbox)
  // Ensures origin/<branch> exists even for single-branch clones.
  console.log(`[auto-pull] fetching origin/${branch}…`)
  await git.fetchBranch(repoPath, branch, token)

  const behind = await commitsBehind(sandbox, repoPath, branch)
  console.log(`[auto-pull] ${branch} is ${behind} commit(s) behind origin/${branch}`)
  if (behind === 0) {
    console.log(`[auto-pull] up-to-date — nothing to pull`)
    return { status: "up-to-date" }
  }

  console.log(`[auto-pull] merging origin/${branch} (${behind} commit(s))…`)
  const result = await mergeRemote(sandbox, repoPath, branch, behind)
  if (result.status === "conflict") {
    console.log(
      `[auto-pull] CONFLICT merging origin/${branch} — ${result.conflictedFiles.length} file(s): ${result.conflictedFiles.join(", ") || "(none)"} (merge left in progress)`
    )
  } else if (result.status === "pulled") {
    console.log(`[auto-pull] merged cleanly — pulled ${result.commits} commit(s) from ${branch}`)
  } else if (result.status === "error") {
    console.error(
      `[auto-pull] ERROR — merge did not apply (still ${behind} behind); agent will run on the un-pulled tree:\n${result.message}`
    )
  }
  return result
}
