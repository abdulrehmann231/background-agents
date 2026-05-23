/**
 * POST /api/scheduled-jobs/<id>/mcp-servers/<serverId>/smithery-finalize
 *
 * Called by the client after the Smithery OAuth popup closes. Polls Smithery
 * for `connected` state and persists the credentials on success.
 *
 * Returns { connected: true } on success, 400 otherwise.
 */
import { prisma } from "@/lib/db/prisma"
import { encrypt } from "@/lib/db/encryption"
import {
  requireAuth,
  isAuthError,
  badRequest,
  notFound,
  serverConfigError,
  internalError,
  getJobWithAuth,
} from "@/lib/db/api-helpers"
import { createSmitheryProvider } from "@upstream/mcp-providers"

export async function POST(
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
  if (!server || server.jobId !== jobId) return notFound("Server not found")

  if (!server.smitheryConnectionId) {
    return badRequest("Server has no Smithery connection id")
  }

  const apiKey = process.env.SMITHERY_API_KEY
  if (!apiKey) return serverConfigError("SMITHERY_API_KEY")

  try {
    const smithery = createSmitheryProvider({
      apiKey,
      namespace: process.env.SMITHERY_NAMESPACE,
    })

    const status = await smithery.getConnectionStatus(
      server.smitheryConnectionId
    )

    if (status.state === "connected") {
      const namespace = await smithery.getNamespace()
      if (!namespace) {
        return Response.json(
          { error: "Failed to resolve Smithery namespace" },
          { status: 500 }
        )
      }

      const mcpEndpoint = smithery.getMcpEndpointWithNamespace(
        namespace,
        server.smitheryConnectionId
      )

      await prisma.scheduledJobMcpServer.update({
        where: { id: serverId },
        data: {
          mcpUrl: mcpEndpoint,
          smitheryNamespace: namespace,
          encryptedApiKey: encrypt(apiKey),
          status: "connected",
          lastError: null,
        },
      })

      return Response.json({ connected: true })
    }

    return Response.json(
      { error: "Connection not yet authorized. Please try again." },
      { status: 400 }
    )
  } catch (err) {
    return internalError(err)
  }
}
