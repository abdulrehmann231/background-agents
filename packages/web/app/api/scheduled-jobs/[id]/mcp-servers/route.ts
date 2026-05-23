/**
 * GET  /api/scheduled-jobs/<id>/mcp-servers     list connections on this job
 * POST /api/scheduled-jobs/<id>/mcp-servers     start a new connection via Smithery
 *
 * Mirror of /api/chats/<chatId>/mcp-servers, scoped to a ScheduledJob.
 * Connections persist on the job; each run loads them via loadJobMcpServers.
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
import {
  createSmitheryProvider,
  getSmitheryConnectionId,
  isSmitheryServer,
} from "@upstream/mcp-providers"

interface ConnectBody {
  slug?: string
  url?: string
  name?: string
  iconUrl?: string | null
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth
  const { userId } = auth
  const { id: jobId } = await params

  const job = await getJobWithAuth(jobId, userId)
  if (!job) return notFound("Scheduled job not found")

  const servers = await prisma.scheduledJobMcpServer.findMany({
    where: { jobId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      qualifiedName: true,
      displayName: true,
      iconUrl: true,
      status: true,
      lastError: true,
      createdAt: true,
    },
  })

  return Response.json({ servers })
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth
  const { userId } = auth
  const { id: jobId } = await params

  const job = await getJobWithAuth(jobId, userId)
  if (!job) return notFound("Scheduled job not found")

  const apiKey = process.env.SMITHERY_API_KEY
  if (!apiKey) return serverConfigError("SMITHERY_API_KEY")

  let body: ConnectBody
  try {
    body = await req.json()
  } catch {
    return badRequest("Invalid JSON body")
  }

  const { slug, url, name, iconUrl } = body
  if (!slug || !url || !name) {
    return badRequest("Missing required fields: slug, url, name")
  }

  if (!isSmitheryServer(url)) {
    return badRequest(
      "Only Smithery-hosted servers (server.smithery.ai) are supported"
    )
  }

  try {
    const smithery = createSmitheryProvider({
      apiKey,
      namespace: process.env.SMITHERY_NAMESPACE,
    })
    // "job" prefix keeps the namespace distinct from chat-scoped ids.
    const connectionId = getSmitheryConnectionId(jobId, slug, "job")
    const result = await smithery.createConnection(url, connectionId, name)

    if (result.status === "error") {
      return Response.json(
        { error: result.error ?? "Smithery connection failed" },
        { status: 502 }
      )
    }

    const isConnected = result.status === "connected"
    const row = {
      smitheryConnectionId: connectionId,
      smitheryNamespace: result.namespace,
      mcpUrl: result.mcpEndpoint,
      status: isConnected ? "connected" : "pending",
      encryptedApiKey: isConnected ? encrypt(apiKey) : null,
      lastError: null,
    }
    const { id: serverId } = await prisma.scheduledJobMcpServer.upsert({
      where: { jobId_qualifiedName: { jobId, qualifiedName: slug } },
      create: {
        jobId,
        qualifiedName: slug,
        displayName: name,
        iconUrl: iconUrl ?? null,
        ...row,
      },
      update: {
        displayName: name,
        iconUrl: iconUrl ?? null,
        ...row,
      },
      select: { id: true },
    })

    if (isConnected) {
      return Response.json({ connected: true, serverId })
    }
    return Response.json({
      connected: false,
      serverId,
      authUrl: result.authorizationUrl,
    })
  } catch (err) {
    return internalError(err)
  }
}
