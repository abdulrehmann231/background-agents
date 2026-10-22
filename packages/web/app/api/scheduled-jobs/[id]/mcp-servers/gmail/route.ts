/**
 * POST /api/scheduled-jobs/<id>/mcp-servers/gmail
 *
 * Add a sentinel row pointing at our Gmail MCP server. The runtime loader
 * mints a per-turn connection token; the row's toolPolicy scopes the tools.
 */
import { resolveMcpOwner } from "@/lib/mcp/owner"
import { attachGmailResponse } from "@/lib/mcp/connections"

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id: jobId } = await params

  const resolved = await resolveMcpOwner({ kind: "job", id: jobId })
  if (!resolved.ok) return resolved.response
  return attachGmailResponse(resolved.owner, resolved.userId)
}
