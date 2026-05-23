/**
 * POST /api/scheduled-jobs/<id>/mcp-servers/github
 *
 * Add a sentinel ScheduledJobMcpServer row that points at GitHub's hosted MCP.
 * The agent-side loader detects the sentinel qualifiedName and mints a fresh
 * installation token on every run from the owning user's
 * githubAppInstallationId.
 *
 * Requires the user to have completed the GitHub App install first.
 */
import { prisma } from "@/lib/db/prisma"
import {
  requireAuth,
  isAuthError,
  notFound,
  internalError,
  getJobWithAuth,
} from "@/lib/db/api-helpers"
import { GITHUB_MCP_QUALIFIED_NAME, GITHUB_MCP_URL } from "@upstream/mcp-providers"

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth
  const { userId } = auth
  const { id: jobId } = await params

  const job = await getJobWithAuth(jobId, userId)
  if (!job) return notFound("Scheduled job not found")

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { githubAppInstallationId: true },
  })
  if (!user?.githubAppInstallationId) {
    return Response.json(
      { error: "GitHub App not installed for this user" },
      { status: 409 }
    )
  }

  try {
    const { id: serverId } = await prisma.scheduledJobMcpServer.upsert({
      where: {
        jobId_qualifiedName: {
          jobId,
          qualifiedName: GITHUB_MCP_QUALIFIED_NAME,
        },
      },
      create: {
        jobId,
        qualifiedName: GITHUB_MCP_QUALIFIED_NAME,
        displayName: "GitHub",
        iconUrl: null,
        mcpUrl: GITHUB_MCP_URL,
        status: "connected",
      },
      update: {
        status: "connected",
        lastError: null,
      },
      select: { id: true },
    })
    return Response.json({ connected: true, serverId })
  } catch (err) {
    return internalError(err)
  }
}
