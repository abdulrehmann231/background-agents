/**
 * Wrappers around the /api/sandbox/git endpoint, used by the git-dialogs hook.
 *
 * The endpoint is action-dispatched — every request goes to the same URL with
 * an "action" discriminator. Rather than make each handler in useGitDialogs
 * repeat the fetch/headers/JSON.stringify dance, we route through callSandboxGit
 * here. The caller still owns response interpretation (409-vs-error vs success,
 * which dialog state to clear, etc.) because that varies per action.
 */

/** All supported actions on /api/sandbox/git. Must match the route handler. */
export type SandboxGitAction =
  | "merge"
  | "rebase"
  | "force-push"
  | "abort-merge"
  | "abort-rebase"
  | "check-rebase-status"

export interface SandboxGitResult<T = unknown> {
  /** True iff HTTP 2xx. */
  ok: boolean
  /** Raw HTTP status — needed so callers can distinguish 409 conflict from 5xx error. */
  status: number
  /** Parsed JSON body. Empty object if the response wasn't valid JSON. */
  data: T
  /**
   * Set when the sandbox had expired and this call transparently recreated it
   * (see the 410 handling below) before retrying. Callers that hold a chat's
   * sandboxId locally (e.g. useGitDialogs) must persist this so the *next*
   * call doesn't hit the same dead id again.
   */
  recreatedSandboxId?: string
}

interface SandboxGitBody {
  sandboxId: string
  repoPath: string
  action: SandboxGitAction
  /** Needed to call the recreate endpoint if the sandbox has expired. */
  chatId?: string
}

/**
 * POST to /api/sandbox/git. Each action has its own payload shape (merge needs
 * targetBranch/squash/etc., abort-rebase needs almost nothing). The base
 * `sandboxId` + `repoPath` + `action` triplet is required; the rest spreads
 * straight onto the request body.
 *
 * Errors are *not* thrown — a non-OK response still returns a `SandboxGitResult`
 * with `ok: false` so the caller can inspect `status` and `data`.
 *
 * A 410 (SANDBOX_NOT_FOUND — the sandbox was deleted/auto-expired, not just
 * stopped) is handled transparently here: recreate it via the same path the
 * dev-server preview panel uses, then retry the original request once against
 * the fresh sandbox. This keeps every call site (handleRebase, handleMerge,
 * etc.) from having to know about sandbox expiry at all — to the user, a
 * rebase on an expired sandbox should just work, same as on a live one.
 */
export async function callSandboxGit<T = unknown>(
  body: SandboxGitBody & Record<string, unknown>
): Promise<SandboxGitResult<T>> {
  const res = await fetch("/api/sandbox/git", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

  if (res.status === 410 && body.chatId) {
    const recreated = await recreateSandbox(body.chatId)
    if (recreated) {
      const retryRes = await fetch("/api/sandbox/git", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, sandboxId: recreated.sandboxId }),
      })
      const retryData = (await retryRes.json().catch(() => ({}))) as T
      return { ok: retryRes.ok, status: retryRes.status, data: retryData, recreatedSandboxId: recreated.sandboxId }
    }
  }

  const data = (await res.json().catch(() => ({}))) as T
  return { ok: res.ok, status: res.status, data }
}

/**
 * Recreate a chat's sandbox after it expired, mirroring the dev-server preview
 * panel's recovery path (server-preview.tsx's handleRecreate) so there's one
 * recreation flow shared by every surface that can hit an expired sandbox.
 * Returns null on failure — callers fall back to surfacing the original error.
 */
async function recreateSandbox(chatId: string): Promise<{ sandboxId: string } | null> {
  try {
    const res = await fetch(`/api/chats/${chatId}/sandbox/recreate`, { method: "POST" })
    const data = await res.json().catch(() => null)
    if (!res.ok || !data?.sandboxId) return null
    return { sandboxId: data.sandboxId }
  } catch {
    return null
  }
}
