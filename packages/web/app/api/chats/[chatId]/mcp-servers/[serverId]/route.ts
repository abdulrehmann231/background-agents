/**
 * DELETE /api/chats/<chatId>/mcp-servers/<serverId>
 * PATCH  /api/chats/<chatId>/mcp-servers/<serverId>  { toolPolicy }  (Gmail only)
 */
import { resolveMcpOwner } from "@/lib/mcp/owner"
import { disconnectResponse, updateToolPolicyResponse } from "@/lib/mcp/connections"

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ chatId: string; serverId: string }> }
): Promise<Response> {
  const { chatId, serverId } = await params

  const resolved = await resolveMcpOwner({ kind: "chat", id: chatId })
  if (!resolved.ok) return resolved.response
  return disconnectResponse(resolved.owner, serverId)
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ chatId: string; serverId: string }> }
): Promise<Response> {
  const { chatId, serverId } = await params

  const resolved = await resolveMcpOwner({ kind: "chat", id: chatId })
  if (!resolved.ok) return resolved.response
  const body: unknown = await req.json().catch(() => null)
  return updateToolPolicyResponse(resolved.owner, serverId, body)
}
