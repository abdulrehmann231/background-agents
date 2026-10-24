import { Daytona } from "@daytonaio/sdk"
import { randomUUID } from "crypto"
import { NEW_REPOSITORY } from "@/lib/types"
import { prisma } from "@/lib/db/prisma"
import { createSandboxForChat, ensureSandboxStarted, installSkillsForRepo } from "@/lib/sandbox"
import {
  requireAuth,
  isAuthError,
  getChatWithAuth,
  notFound,
  serverConfigError,
  internalError,
  getGitHubToken,
} from "@/lib/db/api-helpers"

/**
 * POST /api/chats/[chatId]/sandbox/recreate
 *
 * Explicit recovery path for a sandbox that Daytona auto-deleted (the preview
 * panel's "expired" state — see `lib/sandbox-lifecycle.ts`). The agent-message
 * route (`ensure-sandbox.ts`) already recreates a dead sandbox transparently
 * whenever the user sends a new message; this route exposes the *same*
 * recreation path directly to the preview panel, so clicking refresh on an
 * expired preview doesn't require going back to the chat and sending a message
 * first — it only re-probed the same gone sandboxId forever, which can never
 * succeed (see `/api/sandbox/state`, which never creates anything).
 *
 * Restores the chat's existing branch (if it has one) so the recreated
 * sandbox picks up where the old one left off, same as a first message after
 * deletion would. Dev-server restart recipes live on the chat row, keyed by
 * current sandboxId (see `lib/db/dev-servers-store.ts`), so they carry over
 * automatically once this updates `chat.sandboxId` — a follow-up explicit
 * refresh of the server-preview panel can still replay the dev server command.
 *
 * Body: {} (chatId comes from the route param)
 * Responses:
 *   200 { sandboxId, previewUrlPattern, branch }
 *   404 — chat not found / not owned by caller
 *   410 { error: "SANDBOX_NOT_FOUND" } — cloned repo with no GitHub token to
 *     reclone (the one genuinely unrecoverable case, same as ensure-sandbox.ts)
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ chatId: string }> }
) {
  const { chatId } = await params

  const auth = await requireAuth()
  if (isAuthError(auth)) return auth

  const chat = await getChatWithAuth(chatId, auth.userId)
  if (!chat) return notFound("Chat not found")

  const daytonaApiKey = process.env.DAYTONA_API_KEY
  if (!daytonaApiKey) return serverConfigError("DAYTONA_API_KEY")
  const daytona = new Daytona({ apiKey: daytonaApiKey })

  // If the sandbox is actually still alive (e.g. the panel's probe raced a
  // transient 404, or the user retried twice), don't create a second one —
  // just make sure it's started and hand back what's already there.
  if (chat.sandboxId) {
    try {
      const sandbox = await daytona.get(chat.sandboxId)
      await ensureSandboxStarted(sandbox)
      return Response.json({
        sandboxId: chat.sandboxId,
        previewUrlPattern: chat.previewUrlPattern,
        branch: chat.branch,
      })
    } catch {
      // Confirmed gone — fall through and recreate.
    }
  }

  const isNewRepo = chat.repo === NEW_REPOSITORY || chat.repo === "__new__"
  const githubToken = isNewRepo ? null : await getGitHubToken(auth.userId)

  if (!isNewRepo && !githubToken) {
    await prisma.chat.update({
      where: { id: chatId },
      data: { sandboxId: null, branch: null, previewUrlPattern: null, status: "error" },
    })
    return Response.json(
      { error: "SANDBOX_NOT_FOUND", message: "Sandbox not found. GitHub re-authentication required to recreate." },
      { status: 410 }
    )
  }

  try {
    await prisma.chat.update({ where: { id: chatId }, data: { status: "creating" } })

    const restoreExistingBranch = !!chat.branch
    const newBranch = chat.branch ?? `agent/${randomUUID().slice(0, 8)}`

    const created = await createSandboxForChat({
      daytona,
      repo: chat.repo,
      baseBranch: chat.baseBranch ?? "main",
      newBranch,
      githubToken: githubToken ?? undefined,
      userId: auth.userId,
      restoreExistingBranch,
    })

    // Freshly created sandbox: no agent conversation history on disk, so any
    // stale session pointer must be dropped (same reasoning as ensure-sandbox.ts)
    // or the next turn's "resume" would point at a session the CLI can't find.
    await prisma.chat.update({
      where: { id: chatId },
      data: {
        sandboxId: created.sandboxId,
        branch: created.branch,
        previewUrlPattern: created.previewUrlPattern ?? null,
        sessionId: null,
        status: "idle",
      },
    })

    if (chat.repo !== NEW_REPOSITORY) {
      await installSkillsForRepo(created.sandbox, auth.userId, chat.repo)
    }

    return Response.json({
      sandboxId: created.sandboxId,
      previewUrlPattern: created.previewUrlPattern ?? null,
      branch: created.branch,
    })
  } catch (error) {
    await prisma.chat.update({ where: { id: chatId }, data: { status: "error" } }).catch(() => {})
    return internalError(error)
  }
}
