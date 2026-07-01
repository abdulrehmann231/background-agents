import { createSandboxGit, type SandboxLike } from "@background-agents/sandbox-git"
import { prisma } from "@/lib/db/prisma"
import { getUserPushOptions } from "@/lib/git/push-options"
import { isInConflictState } from "@/lib/git/sandbox-git-ops"
import {
  clearPushFailureMessages,
  createPushFailedMessage,
} from "@/lib/db/git-messages"

/** Client-notification payload for a push that advanced the remote. */
export interface PushInfo {
  branch: string
  commits: number
  commitSha?: string
}

/**
 * Auto-push a completed turn to its remote branch, and reconcile the chat's git
 * messages.
 *
 * This is the single backend routine for post-turn pushing. Both finalizers call
 * it — the SSE stream (fast, while a client watches) and the agent-lifecycle
 * cron (the always-on fallback for unwatched runs) — so the behaviour is
 * identical no matter who detected completion first:
 *
 * - skips while a merge/rebase is in progress (mid-conflict HEAD is partial);
 * - on a failed push, records ONE deduped "Push failed" message;
 * - on a push that advances the remote, clears any stale failure and returns the
 *   {@link PushInfo} so a watching client can raise a notification.
 *
 * Callers MUST invoke this BEFORE releasing the chat from "running"
 * (backgroundSessionId → null). Releasing first excludes the cron fallback, so a
 * crash between release and push would strand the commits until the next turn.
 *
 * Returns null when nothing was pushed (no branch, no token, conflict, failure,
 * or already up to date).
 *
 * Never throws: callers run it right before releasing the chat from "running",
 * so an unexpected error here must not skip that release. A push failure is
 * recorded as a message; any other error is swallowed (logged), leaving the
 * cron fallback to retry on a later turn.
 */
export async function autoPushChat(params: {
  sandbox: SandboxLike
  repoPath: string
  chatId: string
  userId: string
  branch: string
}): Promise<PushInfo | null> {
  const { sandbox, repoPath, chatId, userId, branch } = params

  try {
    // Skip while a merge/rebase is unresolved — HEAD isn't a pushable snapshot.
    if (await isInConflictState(sandbox, repoPath)) return null

    const account = await prisma.account.findFirst({
      where: { userId, provider: "github" },
      select: { access_token: true },
    })
    if (!account?.access_token) return null

    const git = createSandboxGit(sandbox)
    const pushOptions = await getUserPushOptions(userId)

    let result
    try {
      // `--porcelain` tells us whether the remote ref actually advanced.
      result = await git.push(repoPath, account.access_token, pushOptions)
    } catch (err) {
      // Deduped so concurrent finalizers don't spam identical failures.
      await createPushFailedMessage(
        chatId,
        err instanceof Error ? err.message : "Unknown error"
      )
      return null
    }

    if (!result.updated) return null // e.g. "Everything up-to-date"

    // A push landed — drop any stale failure + its dead force-push link.
    await clearPushFailureMessages(chatId)

    // Best-effort commit count + sha for the client notification.
    const range = result.range ?? "HEAD --not --remotes=origin"
    const countRes = await sandbox.process.executeCommand(
      `cd ${repoPath} && git rev-list --count ${range} 2>/dev/null || echo 0`
    )
    const commits = parseInt(countRes.result.trim() || "0", 10) || 0

    const headRes = await sandbox.process.executeCommand(
      `cd ${repoPath} && git rev-parse --short HEAD 2>/dev/null || echo ""`
    )
    const commitSha = headRes.result.trim() || undefined

    return { branch, commits, commitSha }
  } catch (err) {
    console.error(`[auto-push] Unexpected error for chat ${chatId}:`, err)
    return null
  }
}
