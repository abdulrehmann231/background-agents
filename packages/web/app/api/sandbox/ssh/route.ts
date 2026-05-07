import { Daytona } from "@daytonaio/sdk"
import { ensureSandboxStarted } from "@/lib/sandbox"

export const maxDuration = 30

/**
 * POST /api/sandbox/ssh
 *
 * Creates a short-lived SSH access for the sandbox and returns the ssh command
 * so the browser can construct a `vscode://vscode-remote/ssh-remote+host/path`
 * link for opening the workspace in VS Code.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { sandboxId?: string } | null
  if (!body) return Response.json({ error: "Invalid JSON body" }, { status: 400 })
  const { sandboxId } = body
  if (!sandboxId) return Response.json({ error: "Missing sandboxId" }, { status: 400 })

  const daytonaApiKey = process.env.DAYTONA_API_KEY
  if (!daytonaApiKey) {
    return Response.json({ error: "Daytona API key not configured" }, { status: 500 })
  }

  try {
    const daytona = new Daytona({ apiKey: daytonaApiKey })
    let sandbox
    try {
      sandbox = await daytona.get(sandboxId)
    } catch {
      return Response.json({ error: "SANDBOX_NOT_FOUND" }, { status: 410 })
    }
    await ensureSandboxStarted(sandbox)
    const sshAccess = await sandbox.createSshAccess(60)
    return Response.json({ sshCommand: sshAccess.sshCommand })
  } catch (error) {
    console.error("[sandbox/ssh] Error:", error)
    const message = error instanceof Error ? error.message : "Unknown error"
    return Response.json({ error: message }, { status: 500 })
  }
}
