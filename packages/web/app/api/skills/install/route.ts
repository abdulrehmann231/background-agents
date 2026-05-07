import { NextRequest } from "next/server"
import { Daytona } from "@daytonaio/sdk"
import { prisma } from "@/lib/db/prisma"
import {
  requireAuth,
  isAuthError,
  badRequest,
  notFound,
  internalError,
  serverConfigError,
} from "@/lib/db/api-helpers"
import { PATHS } from "@/lib/constants"

// =============================================================================
// POST - Install skills into a chat's sandbox
// =============================================================================

interface InstallBody {
  chatId: string
  skillIds?: string[] // If omitted, install ALL skills for the chat's repo
}

export async function POST(req: NextRequest): Promise<Response> {
  const authResult = await requireAuth()
  if (isAuthError(authResult)) return authResult
  const { userId } = authResult

  const daytonaApiKey = process.env.DAYTONA_API_KEY
  if (!daytonaApiKey) return serverConfigError("DAYTONA_API_KEY")

  try {
    const body: InstallBody = await req.json()

    if (!body.chatId) {
      return badRequest("chatId is required")
    }

    // Verify chat ownership and get sandbox info
    const chat = await prisma.chat.findUnique({
      where: { id: body.chatId },
      select: { userId: true, sandboxId: true, repo: true },
    })

    if (!chat || chat.userId !== userId) {
      return notFound("Chat not found")
    }

    if (!chat.sandboxId) {
      return badRequest("Chat has no sandbox — send a message first")
    }

    // Fetch skills to install
    const whereClause: { userId: string; repo: string; id?: { in: string[] } } = {
      userId,
      repo: chat.repo,
    }
    if (body.skillIds && body.skillIds.length > 0) {
      whereClause.id = { in: body.skillIds }
    }

    const skills = await prisma.skill.findMany({
      where: whereClause,
      orderBy: { createdAt: "asc" },
    })

    if (skills.length === 0) {
      return Response.json({ installed: 0, total: 0, results: [] })
    }

    // Connect to sandbox
    const daytona = new Daytona({ apiKey: daytonaApiKey })
    const sandbox = await daytona.get(chat.sandboxId)

    const repoPath = `${PATHS.SANDBOX_HOME}/project`
    const results: { fullHandle: string; success: boolean; error?: string }[] = []

    for (const skill of skills) {
      try {
        // fullHandle is "owner/repo/skillId" — extract parts for install command
        // Must use --agent '*' -y for non-interactive sandbox environments
        const parts = skill.fullHandle.split("/")
        const source = parts.length >= 2 ? `${parts[0]}/${parts[1]}` : skill.fullHandle
        const skillFlag = parts.length >= 3 ? ` --skill ${parts.slice(2).join("/")}` : ""
        const installCmd = `npx -y skills add ${source}${skillFlag} --agent '*' -y`
        const cmd = await sandbox.process.executeCommand(
          `cd ${repoPath} && ${installCmd} 2>&1`
        )
        const success = cmd.exitCode === 0
        results.push({
          fullHandle: skill.fullHandle,
          success,
          error: success ? undefined : cmd.result?.trim(),
        })
      } catch (error) {
        results.push({
          fullHandle: skill.fullHandle,
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        })
      }
    }

    const installed = results.filter((r) => r.success).length
    return Response.json({ installed, total: skills.length, results })
  } catch (error) {
    return internalError(error)
  }
}
