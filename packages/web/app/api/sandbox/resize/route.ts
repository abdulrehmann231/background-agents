import { Daytona } from "@daytonaio/sdk"
import { badRequest, requireAdmin, isAuthError, serverConfigError } from "@/lib/db/api-helpers"

/** Hard ceiling enforced server-side regardless of what the client sends. */
const MAX_MEMORY_GB = 10
const MAX_DISK_GB = 10

/**
 * GET /api/sandbox/resize?sandboxId=...
 *
 * Admin-only: returns the sandbox's current memory/disk allocation (GiB) so
 * the resize modal can seed its sliders with what's actually provisioned
 * instead of a hardcoded default — otherwise reopening the modal after a
 * successful resize would show the sliders back at their starting position
 * even though the sandbox itself kept the new allocation.
 */
export async function GET(req: Request) {
  const auth = await requireAdmin()
  if (isAuthError(auth)) return auth

  const sandboxId = new URL(req.url).searchParams.get("sandboxId")
  if (!sandboxId) {
    return badRequest("Missing sandboxId")
  }

  const daytonaApiKey = process.env.DAYTONA_API_KEY
  if (!daytonaApiKey) {
    return serverConfigError("DAYTONA_API_KEY")
  }

  try {
    const daytona = new Daytona({ apiKey: daytonaApiKey })
    const sandbox = await daytona.get(sandboxId)
    return Response.json({ memory: sandbox.memory, disk: sandbox.disk })
  } catch (error) {
    console.error("[sandbox/resize] GET error:", error)
    const message = error instanceof Error ? error.message : "Unknown error"
    return Response.json({ error: message }, { status: 500 })
  }
}

/**
 * POST /api/sandbox/resize
 *
 * Admin-only: bump a sandbox's RAM and/or disk allocation. Mirrors
 * app/api/sandbox/delete/route.ts for the Daytona call shape, but gates on
 * `requireAdmin` instead of sandbox ownership — this is an operator action,
 * not something a chat's owner can do to their own sandbox.
 *
 * Disk resize requires the sandbox to be stopped (per the Daytona SDK); CPU/
 * memory can be hot-resized on a running sandbox. To keep this one request
 * work for either case, we stop first whenever a disk change is requested,
 * resize, then restart.
 */
export async function POST(req: Request) {
  const auth = await requireAdmin()
  if (isAuthError(auth)) return auth

  const body = await req.json()
  const { sandboxId, memory, disk } = body

  if (!sandboxId) {
    return badRequest("Missing sandboxId")
  }

  const memoryGb = memory == null ? undefined : Number(memory)
  const diskGb = disk == null ? undefined : Number(disk)

  if (memoryGb == null && diskGb == null) {
    return badRequest("Must specify memory and/or disk")
  }
  if (memoryGb != null && (!Number.isFinite(memoryGb) || memoryGb < 1 || memoryGb > MAX_MEMORY_GB)) {
    return badRequest(`memory must be between 1 and ${MAX_MEMORY_GB} GiB`)
  }
  if (diskGb != null && (!Number.isFinite(diskGb) || diskGb < 1 || diskGb > MAX_DISK_GB)) {
    return badRequest(`disk must be between 1 and ${MAX_DISK_GB} GiB`)
  }

  const daytonaApiKey = process.env.DAYTONA_API_KEY
  if (!daytonaApiKey) {
    return serverConfigError("DAYTONA_API_KEY")
  }

  try {
    const daytona = new Daytona({ apiKey: daytonaApiKey })
    const sandbox = await daytona.get(sandboxId)

    // Daytona only supports growing memory/disk, never shrinking (hot resize
    // can only increase CPU/memory, and disk resize throws on any decrease).
    // The UI already floors the sliders at the current allocation, but check
    // again here in case the request didn't come from that UI.
    if (memoryGb != null && memoryGb < sandbox.memory) {
      return badRequest(`memory can only be increased (currently ${sandbox.memory} GiB)`)
    }
    if (diskGb != null && diskGb < sandbox.disk) {
      return badRequest(`disk can only be increased (currently ${sandbox.disk} GiB)`)
    }

    const wasRunning = sandbox.state === "started"
    // Disk resize requires a stopped sandbox; CPU/memory hot-resize on a
    // running one. Stop unconditionally when disk is changing so one request
    // handles both cases.
    if (diskGb != null && wasRunning) {
      await sandbox.stop()
    }

    await sandbox.resize({
      ...(memoryGb != null ? { memory: memoryGb } : {}),
      ...(diskGb != null ? { disk: diskGb } : {}),
    })
    await sandbox.waitForResizeComplete()

    if (diskGb != null && wasRunning) {
      await sandbox.start()
    }

    return Response.json({ success: true, memory: memoryGb, disk: diskGb })
  } catch (error) {
    console.error("[sandbox/resize] Error:", error)
    const message = error instanceof Error ? error.message : "Unknown error"
    return Response.json({ error: message }, { status: 500 })
  }
}
