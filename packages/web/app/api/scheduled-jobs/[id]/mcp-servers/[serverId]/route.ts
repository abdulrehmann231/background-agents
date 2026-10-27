/**
 * DELETE /api/scheduled-jobs/<id>/mcp-servers/<serverId>
 * PATCH  /api/scheduled-jobs/<id>/mcp-servers/<serverId>  { toolPolicy }  (Gmail only)
 */
import { resolveMcpOwner } from "@/lib/mcp/owner"
import { disconnectResponse, updateToolPolicyResponse } from "@/lib/mcp/connections"

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; serverId: string }> }
): Promise<Response> {
  const { id: jobId, serverId } = await params

  const resolved = await resolveMcpOwner({ kind: "job", id: jobId })
  if (!resolved.ok) return resolved.response
  return disconnectResponse(resolved.owner, serverId)
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; serverId: string }> }
): Promise<Response> {
  const { id: jobId, serverId } = await params

  const resolved = await resolveMcpOwner({ kind: "job", id: jobId })
  if (!resolved.ok) return resolved.response
  const body: unknown = await req.json().catch(() => null)
  return updateToolPolicyResponse(resolved.owner, serverId, body)
}
