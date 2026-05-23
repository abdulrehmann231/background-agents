/**
 * DELETE /api/chats/<chatId>/mcp-servers/<serverId>
 */
import { requireAuth, isAuthError, notFound } from "@/lib/db/api-helpers"
import { requireMcpOwnerAuth, type McpOwner } from "@/lib/mcp/owner"
import { disconnectResponse } from "@/lib/mcp/connections"

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ chatId: string; serverId: string }> }
): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth
  const { chatId, serverId } = await params

  const owner: McpOwner = { kind: "chat", id: chatId }
  if (!(await requireMcpOwnerAuth(owner, auth.userId))) {
    return notFound("Chat not found")
  }
  return disconnectResponse(owner, serverId)
}
