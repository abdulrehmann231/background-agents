import { Daytona } from "@daytonaio/sdk"
import { createSandboxGit } from "@background-agents/sandbox-git"
import { PATHS } from "@/lib/constants"
import { requireGitHubAuth, isGitHubAuthError, internalError, badRequest, verifySandboxOwnership, forbidden } from "@/lib/db/api-helpers"
import { getUserPushOptions } from "@/lib/git/push-options"

/**
 * Sets up a GitHub remote for an existing local repo in a sandbox and pushes to it.
 * Used when a user creates a new GitHub repo after already starting a chat.
 */
export async function POST(req: Request) {
  // 1. Parse request body
  const body = await req.json()
  const { sandboxId, repoFullName, branch } = body

  if (!sandboxId || !repoFullName || !branch) {
    return badRequest("Missing required fields: sandboxId, repoFullName, branch")
  }

  // 2. Get GitHub token from DB
  const ghAuth = await requireGitHubAuth()
  if (isGitHubAuthError(ghAuth)) {
    return Response.json(
      { error: "Unauthorized - please sign in with GitHub" },
      { status: 401 }
    )
  }
  const githubToken = ghAuth.token
  const userId = ghAuth.userId

  // Ownership gate: signing in isn't enough — the caller must own this sandbox,
  // otherwise they could point another user's sandbox at their own repo and push
  // that user's working tree to it.
  if (!(await verifySandboxOwnership(userId, sandboxId))) {
    return forbidden()
  }

  // 3. Get Daytona API key
  const daytonaApiKey = process.env.DAYTONA_API_KEY
  if (!daytonaApiKey) {
    return Response.json(
      { error: "Daytona API key not configured" },
      { status: 500 }
    )
  }

  try {
    // 4. Get user settings for push options
    const pushOptions = await getUserPushOptions(userId)

    // 5. Get sandbox from Daytona
    const daytona = new Daytona({ apiKey: daytonaApiKey })
    const sandbox = await daytona.get(sandboxId)

    // 6. Always use "project" as the directory name - sandbox/create always uses this
    const repoPath = `${PATHS.SANDBOX_HOME}/project`

    // 7. Set up the remote URL (without credentials - token passed per-operation)
    const remoteUrl = `https://github.com/${repoFullName}.git`

    // Remove existing origin if any, then add the new one
    // Using || true to ignore errors if remote doesn't exist
    await sandbox.process.executeCommand(
      `cd ${repoPath} && git remote remove origin 2>/dev/null || true`
    )
    await sandbox.process.executeCommand(
      `cd ${repoPath} && git remote add origin "${remoteUrl}"`
    )

    // 8. The sandbox's local history for a brand-new-repo chat starts with its
    // own throwaway init commit (README) made before this GitHub repo existed.
    // The GitHub repo has its own, unrelated init commit. Rebase the sandbox's
    // branch onto the real origin/main so it shares ancestry with `main` instead
    // of pushing up a second, disconnected history (which later conflicts on
    // README.md when merging with no common ancestor).
    const git = createSandboxGit(sandbox)
    await git.fetchBranch(repoPath, "main", githubToken)

    const rootCommit = (
      await sandbox.process.executeCommand(
        `cd ${repoPath} && git rev-list --max-parents=0 HEAD`
      )
    ).result.trim()
    const rebaseResult = await sandbox.process.executeCommand(
      `cd ${repoPath} && git rebase --onto origin/main ${rootCommit} HEAD 2>&1`
    )
    if (rebaseResult.exitCode !== 0) {
      await sandbox.process.executeCommand(`cd ${repoPath} && git rebase --abort 2>/dev/null || true`)
      return internalError(new Error(`Failed to rebase onto origin/main: ${rebaseResult.result}`))
    }

    // 9. Push to the remote (token passed via -c http.extraHeader, not stored)
    await git.push(repoPath, githubToken, pushOptions)

    return Response.json({ success: true })
  } catch (error) {
    console.error("[git/setup-remote] Error:", error)
    return internalError(error)
  }
}
