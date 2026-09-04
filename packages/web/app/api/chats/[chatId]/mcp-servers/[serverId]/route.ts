/**
 * DELETE /api/chats/<chatId>/mcp-servers/<serverId>
 */
import { resolveMcpOwner } from "@/lib/mcp/owner"
import { disconnectResponse } from "@/lib/mcp/connections"

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ chatId: string; serverId: string }> }
): Promise<Response> {
  const { chatId, serverId } = await params

  const resolved = await resolveMcpOwner({ kind: "chat", id: chatId })
  if (!resolved.ok) return resolved.response
  return disconnectResponse(resolved.owner, serverId)
}
