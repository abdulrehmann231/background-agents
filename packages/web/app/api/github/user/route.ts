import { requireGitHubAuth, isGitHubAuthError, internalError } from "@/lib/db/api-helpers"
import { getUser } from "@background-agents/common"

export async function GET() {
  const ghAuth = await requireGitHubAuth()
  if (isGitHubAuthError(ghAuth)) return ghAuth

  try {
    const user = await getUser(ghAuth.token)
    // Only the login is needed by clients today; keep the payload small.
    return Response.json({ login: user.login })
  } catch (error: unknown) {
    console.error("[github/user] Error:", error)
    return internalError(error)
  }
}
