/**
 * DELETE /api/scheduled-jobs/<id>/mcp-servers/<serverId>
 *
 * Removes the connection from our DB and (best-effort) from Smithery.
 */
import { prisma } from "@/lib/db/prisma"
import {
  requireAuth,
  isAuthError,
  notFound,
  internalError,
  getJobWithAuth,
} from "@/lib/db/api-helpers"
import { createSmitheryProvider } from "@upstream/mcp-providers"

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; serverId: string }> }
): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth
  const { userId } = auth
  const { id: jobId, serverId } = await params

  const job = await getJobWithAuth(jobId, userId)
  if (!job) return notFound("Scheduled job not found")

  const server = await prisma.scheduledJobMcpServer.findUnique({
    where: { id: serverId },
  })
  if (!server || server.jobId !== jobId) {
    return notFound("Server not found")
  }

  try {
    const apiKey = process.env.SMITHERY_API_KEY
    if (apiKey && server.smitheryConnectionId) {
      const smithery = createSmitheryProvider({
        apiKey,
        namespace: process.env.SMITHERY_NAMESPACE,
      })
      await smithery.deleteConnection(server.smitheryConnectionId)
    }

    await prisma.scheduledJobMcpServer.delete({ where: { id: serverId } })

    return Response.json({ deleted: true })
  } catch (err) {
    return internalError(err)
  }
}
