import { Daytona } from "@daytonaio/sdk"
import {
  requireAuth,
  isAuthError,
  badRequest,
  notFound,
  serverConfigError,
  internalError,
} from "@/lib/db/api-helpers"
import { prisma } from "@/lib/db/prisma"
import { ensureSandboxStarted } from "@/lib/sandbox"
import {
  SANDBOX_RESOURCE_BOUNDS,
  clampResource,
  validateResources,
  type SandboxResources,
} from "@/lib/sandbox-resources"

export const maxDuration = 120

/**
 * Sandbox resource scaling — see issue #230.
 *
 * GET  → current CPU / RAM / disk + bounds + state, to populate the modal.
 * POST → resize the sandbox. Restricted to paid (pro/unlimited) plans.
 *
 * Both verify the caller owns a chat bound to the sandbox (IDOR guard), the
 * same pattern as requireChatStreamAccess: never trust the client-supplied
 * sandboxId without checking it maps to a chat owned by the user.
 */

/** Plans allowed to scale sandboxes. Free is excluded (issue #230). */
const PAID_PLANS = new Set(["pro", "unlimited"])

/**
 * Resolve and authorize the sandbox for the current request: require auth,
 * confirm the sandbox belongs to one of the user's chats. Returns the userId,
 * the user's plan, and the verified sandboxId, or an error Response.
 */
async function authorizeSandbox(
  sandboxId: string | undefined
): Promise<{ userId: string; plan: string; sandboxId: string } | Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth
  const { userId } = auth

  if (!sandboxId) return badRequest("Missing sandboxId")

  const [user, chat] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { plan: true } }),
    prisma.chat.findFirst({
      where: { sandboxId, userId },
      select: { id: true },
    }),
  ])

  // Don't reveal whether the sandbox exists for someone else — treat a
  // non-owned (or unknown) sandbox as not found.
  if (!chat) return notFound("Sandbox not found")

  return { userId, plan: user?.plan ?? "free", sandboxId }
}

export async function GET(req: Request): Promise<Response> {
  const sandboxId = new URL(req.url).searchParams.get("sandboxId") ?? undefined

  const authed = await authorizeSandbox(sandboxId)
  if (authed instanceof Response) return authed

  const apiKey = process.env.DAYTONA_API_KEY
  if (!apiKey) return serverConfigError("DAYTONA_API_KEY")

  try {
    const daytona = new Daytona({ apiKey })
    const sandbox = await daytona.get(authed.sandboxId).catch(() => null)
    if (!sandbox) return Response.json({ error: "SANDBOX_NOT_FOUND" }, { status: 410 })

    return Response.json({
      bounds: SANDBOX_RESOURCE_BOUNDS,
      resources: {
        cpu: sandbox.cpu,
        memory: sandbox.memory,
        disk: sandbox.disk,
      } satisfies SandboxResources,
      state: sandbox.state,
      canResize: PAID_PLANS.has(authed.plan),
    })
  } catch (error) {
    console.error("[sandbox/resize] GET error:", error)
    return internalError(error)
  }
}

export async function POST(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => null)) as
    | ({ sandboxId?: string } & Partial<SandboxResources>)
    | null
  if (!body) return badRequest("Invalid JSON body")

  const authed = await authorizeSandbox(body.sandboxId)
  if (authed instanceof Response) return authed

  // Plan gating: paid plans only. Allowed in non-production for local testing
  // so the feature can be exercised without a paid account (issue #230 scopes
  // the restriction to production).
  if (process.env.NODE_ENV === "production" && !PAID_PLANS.has(authed.plan)) {
    return Response.json(
      { error: "UPGRADE_REQUIRED", message: "Sandbox scaling is available on Pro and Unlimited plans." },
      { status: 403 }
    )
  }

  const requested: Partial<SandboxResources> = {}
  if (body.cpu != null) requested.cpu = clampResource("cpu", body.cpu)
  if (body.memory != null) requested.memory = clampResource("memory", body.memory)
  if (body.disk != null) requested.disk = clampResource("disk", body.disk)

  if (Object.keys(requested).length === 0) {
    return badRequest("No resources to update")
  }

  const validationError = validateResources(requested)
  if (validationError) return badRequest(validationError)

  const apiKey = process.env.DAYTONA_API_KEY
  if (!apiKey) return serverConfigError("DAYTONA_API_KEY")

  try {
    const daytona = new Daytona({ apiKey })
    const sandbox = await daytona.get(authed.sandboxId).catch(() => null)
    if (!sandbox) return Response.json({ error: "SANDBOX_NOT_FOUND" }, { status: 410 })

    // Daytona forbids shrinking CPU/RAM/disk. Reject decreases up front with a
    // clear message rather than surfacing the opaque SDK error.
    const decreased = (Object.keys(requested) as (keyof SandboxResources)[]).filter(
      (k) => requested[k]! < sandbox[k]
    )
    if (decreased.length > 0) {
      const names = decreased.map((k) => SANDBOX_RESOURCE_BOUNDS[k].label).join(", ")
      return badRequest(`${names} can only be increased, not decreased`)
    }

    const diskChanged = requested.disk != null && requested.disk !== sandbox.disk

    if (diskChanged) {
      // Disk resize requires a stopped sandbox; CPU/RAM ride along in the same call.
      await sandbox.stop()
      await sandbox.resize(requested)
    } else {
      // Hot resize CPU/RAM on a running sandbox.
      await ensureSandboxStarted(sandbox)
      await sandbox.resize(requested)
    }
    await sandbox.waitForResizeComplete(120)

    return Response.json({
      success: true,
      resources: {
        cpu: sandbox.cpu,
        memory: sandbox.memory,
        disk: sandbox.disk,
      } satisfies SandboxResources,
    })
  } catch (error) {
    console.error("[sandbox/resize] POST error:", error)
    return internalError(error)
  }
}
