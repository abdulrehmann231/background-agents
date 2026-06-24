import { Daytona } from "@daytonaio/sdk"
import { randomUUID } from "crypto"
import { NEW_REPOSITORY } from "@/lib/types"
import { prisma } from "@/lib/db/prisma"
import {
  createSandboxForChat,
  ensureSandboxStarted,
  installSkillsForRepo,
} from "@/lib/sandbox"
import type { ChatRecord, MessagePayload } from "./types"

type DaytonaSandbox = Awaited<ReturnType<Daytona["get"]>>

/**
 * Mutable sandbox bookkeeping shared with the POST handler. The handler seeds it
 * from the chat row and reads it back in its `catch` so a sandbox newly created
 * during this request can be torn down if a *later* stage throws — which is why
 * this is a mutated object rather than only a return value.
 */
export interface SandboxState {
  sandboxId: string | null
  branch: string | null
  previewUrlPattern: string | null
  createdSandbox: boolean
}

export interface EnsuredSandbox {
  sandbox: DaytonaSandbox
  sandboxId: string
  branch: string | null
  previewUrlPattern: string | null
  createdSandbox: boolean
}

/**
 * Terminal Daytona sandbox states a sandbox can never `start()` from again.
 * A sandbox in one of these is effectively gone even though `daytona.get`
 * still resolves it (the API keeps the record around briefly while tearing it
 * down), so we recreate rather than try — and fail — to start it.
 */
const GONE_SANDBOX_STATES = new Set<string>([
  "destroyed",
  "destroying",
  "error",
  "build_failed",
])

function isGoneState(state: string | undefined): boolean {
  return state !== undefined && GONE_SANDBOX_STATES.has(state)
}

/**
 * Transparently recreate a sandbox that was deleted (or is being torn down) out
 * from under us. Restores the chat's existing branch when there is one, else
 * creates a fresh branch — a brand-new clone either way, so the stale agent
 * session pointer is dropped (agent-agnostic) and `state` is kept in sync for
 * the handler's cleanup. Returns the new sandbox details, or a `Response`
 * (410 SANDBOX_NOT_FOUND) only when recreation is genuinely impossible
 * (local/NEW_REPOSITORY with no remote, or a non-new repo with no GitHub token).
 */
async function recreateSandboxForChat(params: {
  daytona: Daytona
  chat: ChatRecord
  chatId: string
  payload: MessagePayload
  githubToken: string | null
  userId: string
  state: SandboxState
}): Promise<
  | { sandbox: DaytonaSandbox; sandboxId: string; branch: string | null; previewUrlPattern: string | null }
  | Response
> {
  const { daytona, chat, chatId, payload, githubToken, userId, state } = params

  const markError = () =>
    prisma.chat.update({
      where: { id: chatId },
      data: { sandboxId: null, branch: null, previewUrlPattern: null, status: "error" },
    })

  // Cannot recreate NEW_REPOSITORY chats - no remote to clone from.
  if (chat.repo === NEW_REPOSITORY || chat.repo === "__new__") {
    await markError()
    return Response.json(
      { error: "SANDBOX_NOT_FOUND", message: "Sandbox not found. Cannot recreate sandbox for local repository." },
      { status: 410 }
    )
  }

  // Cannot recreate a cloned repo without a GitHub token.
  if (!githubToken) {
    await markError()
    return Response.json(
      { error: "SANDBOX_NOT_FOUND", message: "Sandbox not found. GitHub re-authentication required to recreate." },
      { status: 410 }
    )
  }

  // Restore the chat's branch when it has one; otherwise fall back to a fresh
  // branch (mirrors initial creation) rather than erroring — there's simply
  // nothing to restore, which is recoverable.
  const restoreExistingBranch = !!chat.branch
  const newBranch =
    chat.branch ?? payload.newBranch ?? `agent/${randomUUID().slice(0, 8)}`

  console.log(
    `[chats/messages] Recreating sandbox for chat ${chatId} (branch=${newBranch}, restore=${restoreExistingBranch})`
  )

  try {
    await prisma.chat.update({
      where: { id: chatId },
      data: { status: "creating" },
    })

    const recreated = await createSandboxForChat({
      daytona,
      repo: chat.repo,
      baseBranch: chat.baseBranch ?? "main",
      newBranch,
      githubToken,
      userId,
      restoreExistingBranch,
    })

    const sandboxId = recreated.sandboxId
    const branch = recreated.branch
    const previewUrlPattern = recreated.previewUrlPattern ?? null

    // Mark as created so the handler tears it down if a *later* stage throws.
    state.sandboxId = sandboxId
    state.branch = branch
    state.previewUrlPattern = previewUrlPattern
    state.createdSandbox = true

    // The recreated sandbox is a fresh clone with no agent conversation history
    // on disk (it only ever lived in the now-gone sandbox). Drop the stale
    // session pointer so the agent starts a new conversation instead of resuming
    // a session the CLI can't find — both in the DB (future requests) and in
    // memory (this request's resume read). Agent-agnostic: sessionId is the
    // generic resume pointer used by every agent.
    await prisma.chat.update({
      where: { id: chatId },
      data: {
        sandboxId,
        branch,
        previewUrlPattern,
        sessionId: null,
        status: "ready",
      },
    })
    chat.sessionId = null

    console.log(
      `[chats/messages] Successfully recreated sandbox ${sandboxId} for chat ${chatId}, branchRestored=${recreated.branchRestored}`
    )

    return { sandbox: recreated.sandbox, sandboxId, branch, previewUrlPattern }
  } catch (recreationError) {
    console.error(`[chats/messages] Failed to recreate sandbox for chat ${chatId}:`, recreationError)
    await markError()
    return Response.json(
      { error: "SANDBOX_NOT_FOUND", message: "Sandbox not found and recreation failed." },
      { status: 410 }
    )
  }
}

/**
 * Ensure the chat has a live, started sandbox: create one if the chat has none,
 * or transparently recreate one that was deleted out from under us (e.g. by the
 * cleanup cron). Keeps `state` in sync as it goes — so a throw mid-flight leaves
 * the handler enough to clean up — and, on a newly created sandbox, installs the
 * repo's skills.
 *
 * Returns the started sandbox + resolved ids, or a `Response`
 * (410 SANDBOX_NOT_FOUND) when a deleted sandbox cannot be recreated.
 */
export async function ensureSandboxForChat(params: {
  daytona: Daytona
  chat: ChatRecord
  chatId: string
  payload: MessagePayload
  githubToken: string | null
  userId: string
  state: SandboxState
}): Promise<EnsuredSandbox | Response> {
  const { daytona, chat, chatId, payload, githubToken, userId, state } = params

  let sandboxId = state.sandboxId
  let branch = state.branch
  let previewUrlPattern = state.previewUrlPattern
  let createdSandbox = false

  // ── Stage 1: ensure sandbox ────────────────────────────────────────────
  if (!sandboxId) {
    await prisma.chat.update({
      where: { id: chatId },
      data: { status: "creating" },
    })

    const newBranch = payload.newBranch ?? `agent/${randomUUID().slice(0, 8)}`
    const created = await createSandboxForChat({
      daytona,
      repo: chat.repo,
      baseBranch: chat.baseBranch ?? "main",
      newBranch,
      githubToken: githubToken ?? undefined,
      userId,
    })
    sandboxId = created.sandboxId
    branch = created.branch
    previewUrlPattern = created.previewUrlPattern ?? null
    createdSandbox = true
    state.sandboxId = sandboxId
    state.branch = branch
    state.previewUrlPattern = previewUrlPattern
    state.createdSandbox = true

    // A freshly created sandbox is a clean clone with no agent conversation
    // history on disk. If this chat carried a stale session pointer (e.g. a
    // prior sandbox was deleted and a failure path nulled `sandboxId` while
    // leaving `sessionId` set), resuming it would make the agent CLI fail with
    // "No conversation found with session ID". Drop the pointer so the agent
    // starts a new conversation — both in the DB (future requests) and in
    // memory (this request's resume read below). Agent-agnostic: sessionId is
    // the generic resume pointer used by every agent. Mirrors the recreation
    // path in Stage 2.
    await prisma.chat.update({
      where: { id: chatId },
      data: {
        sandboxId,
        branch,
        previewUrlPattern,
        sessionId: null,
        status: "ready",
      },
    })
    chat.sessionId = null
  }

  // ── Stage 2: get (or recreate) a usable sandbox ────────────────────────
  // `daytona.get` only 404s once the sandbox record is fully gone. While a
  // sandbox is being torn down it still resolves in a terminal state
  // (`destroying`/`destroyed`/`error`) it can never start from — so relying on
  // `get` throwing alone would let a dead sandbox slip through and blow up later
  // in `ensureSandboxStarted`'s `start()` (surfacing as a 500 the first time,
  // only succeeding once the record finally disappears on a retry). Treat a
  // dead-but-gettable sandbox the same as a deleted one and recreate it now.
  let sandbox: DaytonaSandbox | null = null
  try {
    const existing = await daytona.get(sandboxId)
    if (!isGoneState(existing.state)) {
      sandbox = existing
    } else {
      console.log(`[chats/messages] Sandbox ${sandboxId} is in terminal state "${existing.state}" for chat ${chatId}`)
    }
  } catch {
    // Fully deleted (e.g., cleanup cronjob): get() 404s. Recreate below.
  }

  if (!sandbox) {
    const recreated = await recreateSandboxForChat({
      daytona,
      chat,
      chatId,
      payload,
      githubToken,
      userId,
      state,
    })
    if (recreated instanceof Response) return recreated
    sandbox = recreated.sandbox
    sandboxId = recreated.sandboxId
    branch = recreated.branch
    previewUrlPattern = recreated.previewUrlPattern
    createdSandbox = true
  }

  await ensureSandboxStarted(sandbox)

  // ── Stage 2a: restore repo-scoped skills ──────────────────────────────
  // On newly created sandboxes (including recreation after deletion),
  // install all skills associated with this user+repo so the agent has
  // them available from the first prompt.
  if (createdSandbox && chat.repo !== NEW_REPOSITORY) {
    await installSkillsForRepo(sandbox, userId, chat.repo)
  }

  return { sandbox, sandboxId, branch, previewUrlPattern, createdSandbox }
}
