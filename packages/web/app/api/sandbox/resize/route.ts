import { Daytona } from "@daytona/sdk"
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

const RESIZE_TIMEOUT_SECONDS = 120

/**
 * Use explicit apiUrl so the SDK does not accidentally hit an older/self-hosted
 * Daytona API that does not support /api/sandbox/:id/resize.
 */
function createDaytonaClient(apiKey: string) {
  return new Daytona({
    apiKey,
    apiUrl: process.env.DAYTONA_API_URL ?? "https://app.daytona.io/api",
    target: process.env.DAYTONA_TARGET ?? "us",
  })
}

function getSandboxResources(sandbox: {
  cpu?: number
  memory?: number
  disk?: number
}): SandboxResources {
  return {
    cpu: Number(sandbox.cpu),
    memory: Number(sandbox.memory),
    disk: Number(sandbox.disk),
  }
}

function isSandboxStarted(state: unknown): boolean {
  const normalized = String(state ?? "").toLowerCase()
  return normalized === "started" || normalized === "running"
}

/**
 * Some Daytona SDK versions expose waitForResizeComplete, some may not.
 * Keeping this optional avoids breaking compilation across nearby SDK versions.
 */
async function waitForResizeIfAvailable(
  sandbox: {
    refreshData: () => Promise<void>
    waitForResizeComplete?: (timeout?: number) => Promise<void>
  },
  timeoutSeconds = RESIZE_TIMEOUT_SECONDS
) {
  if (typeof sandbox.waitForResizeComplete === "function") {
    await sandbox.waitForResizeComplete(timeoutSeconds)
  }

  await sandbox.refreshData()
}

function isDaytonaResizeRouteMissing(error: unknown): boolean {
  const err = error as {
    statusCode?: number
    message?: string
    errorCode?: string
  }

  return (
    err?.statusCode === 404 &&
    typeof err?.message === "string" &&
    err.message.includes("/resize")
  )
}

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
    prisma.user.findUnique({
      where: { id: userId },
      select: { plan: true },
    }),
    prisma.chat.findFirst({
      where: { sandboxId, userId },
      select: { id: true },
    }),
  ])

  // Don't reveal whether the sandbox exists for someone else — treat a
  // non-owned or unknown sandbox as not found.
  if (!chat) return notFound("Sandbox not found")

  return {
    userId,
    plan: user?.plan ?? "free",
    sandboxId,
  }
}

export async function GET(req: Request): Promise<Response> {
  const sandboxId = new URL(req.url).searchParams.get("sandboxId") ?? undefined

  const authed = await authorizeSandbox(sandboxId)
  if (authed instanceof Response) return authed

  const apiKey = process.env.DAYTONA_API_KEY
  if (!apiKey) return serverConfigError("DAYTONA_API_KEY")

  try {
    const daytona = createDaytonaClient(apiKey)

    const sandbox = await daytona.get(authed.sandboxId).catch(() => null)
    if (!sandbox) {
      return Response.json(
        { error: "SANDBOX_NOT_FOUND" },
        { status: 410 }
      )
    }

    await sandbox.refreshData()

    return Response.json({
      bounds: SANDBOX_RESOURCE_BOUNDS,
      resources: getSandboxResources(sandbox),
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
  // so the feature can be exercised without a paid account.
  if (process.env.NODE_ENV === "production" && !PAID_PLANS.has(authed.plan)) {
    return Response.json(
      {
        error: "UPGRADE_REQUIRED",
        message: "Sandbox scaling is available on Pro and Unlimited plans.",
      },
      { status: 403 }
    )
  }

  const requested: Partial<SandboxResources> = {}

  if (body.cpu != null) {
    requested.cpu = clampResource("cpu", body.cpu)
  }

  if (body.memory != null) {
    requested.memory = clampResource("memory", body.memory)
  }

  if (body.disk != null) {
    requested.disk = clampResource("disk", body.disk)
  }

  if (Object.keys(requested).length === 0) {
    return badRequest("No resources to update")
  }

  const validationError = validateResources(requested)
  if (validationError) return badRequest(validationError)

  const apiKey = process.env.DAYTONA_API_KEY
  if (!apiKey) return serverConfigError("DAYTONA_API_KEY")

  try {
    const daytona = createDaytonaClient(apiKey)

    const sandbox = await daytona.get(authed.sandboxId).catch(() => null)
    if (!sandbox) {
      return Response.json(
        { error: "SANDBOX_NOT_FOUND" },
        { status: 410 }
      )
    }

    await sandbox.refreshData()

    const current = getSandboxResources(sandbox)

    /**
     * Daytona rule:
     * - Disk can only increase.
     * - CPU/RAM increases can usually be hot-resized while running.
     * - CPU/RAM decreases require stopping first.
     */
    if (requested.disk != null && requested.disk < current.disk) {
      return badRequest("Disk can only be increased, not decreased")
    }

    const diskChanged =
      requested.disk != null && requested.disk !== current.disk

    const cpuDecreased =
      requested.cpu != null && requested.cpu < current.cpu

    const memoryDecreased =
      requested.memory != null && requested.memory < current.memory

    const needsStoppedResize = diskChanged || cpuDecreased || memoryDecreased

    const wasStarted = isSandboxStarted(sandbox.state)

    try {
      if (needsStoppedResize) {
        await sandbox.stop(RESIZE_TIMEOUT_SECONDS)

        await sandbox.resize(requested, RESIZE_TIMEOUT_SECONDS)

        await waitForResizeIfAvailable(sandbox, RESIZE_TIMEOUT_SECONDS)

        // If the sandbox was running before resize, bring it back up.
        if (wasStarted) {
          await sandbox.start(RESIZE_TIMEOUT_SECONDS)
          await sandbox.refreshData()
        }
      } else {
        // Hot resize CPU/RAM increases on a running sandbox.
        await ensureSandboxStarted(sandbox)

        await sandbox.resize(requested, RESIZE_TIMEOUT_SECONDS)

        await waitForResizeIfAvailable(sandbox, RESIZE_TIMEOUT_SECONDS)
      }
    } catch (resizeError) {
      // If we stopped a running sandbox and resize failed, try to recover it.
      if (needsStoppedResize && wasStarted) {
        try {
          await sandbox.start(RESIZE_TIMEOUT_SECONDS)
        } catch (restartError) {
          console.error(
            "[sandbox/resize] failed to restart after resize error:",
            restartError
          )
        }
      }

      throw resizeError
    }

    await sandbox.refreshData()

    return Response.json({
      success: true,
      resources: getSandboxResources(sandbox),
      state: sandbox.state,
    })
  } catch (error) {
    console.error("[sandbox/resize] POST error:", error)

    if (isDaytonaResizeRouteMissing(error)) {
      return Response.json(
        {
          error: "DAYTONA_RESIZE_UNSUPPORTED",
          message:
            "The Daytona API endpoint being used does not support sandbox resize. Upgrade to @daytona/sdk, set DAYTONA_API_URL=https://app.daytona.io/api, and make sure your Daytona server supports sandbox resizing.",
        },
        { status: 502 }
      )
    }

    return internalError(error)
  }
}