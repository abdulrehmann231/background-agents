/**
 * POST /api/chats/<chatId>/mcp-servers/github
 *
 * Add a sentinel row pointing at GitHub's hosted MCP. The runtime loader
 * mints fresh installation tokens from the user's githubAppInstallationId.
 */
import { requireAuth, isAuthError, notFound } from "@/lib/db/api-helpers"
import { requireMcpOwnerAuth, type McpOwner } from "@/lib/mcp/owner"
import { attachGithubResponse } from "@/lib/mcp/connections"

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ chatId: string }> }
): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth
  const { chatId } = await params

  const owner: McpOwner = { kind: "chat", id: chatId }
  if (!(await requireMcpOwnerAuth(owner, auth.userId))) {
    return notFound("Chat not found")
  }
  return attachGithubResponse(owner, auth.userId)
}
