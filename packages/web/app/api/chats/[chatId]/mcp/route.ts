import { NextRequest } from "next/server"
import { prisma } from "@/lib/db/prisma"
import {
  requireAuth,
  isAuthError,
  getChatWithAuth,
  notFound,
  badRequest,
  internalError,
} from "@/lib/db/api-helpers"

// =============================================================================
// Types
// =============================================================================

/**
 * Valid MCP permission types
 */
const VALID_MCP_PERMISSIONS = ["github", "sentry"] as const
type MCPPermission = (typeof VALID_MCP_PERMISSIONS)[number]

interface MCPPermissionsResponse {
  chatId: string
  mcpPermissions: string[]
  mcpAllowedRepos: string[]
}

// =============================================================================
// GET - Get MCP permissions for a chat
// =============================================================================

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ chatId: string }> }
): Promise<Response> {
  const authResult = await requireAuth()
  if (isAuthError(authResult)) return authResult
  const { userId } = authResult
  const { chatId } = await params

  try {
    const chat = await getChatWithAuth(chatId, userId)
    if (!chat) {
      return notFound("Chat not found")
    }

    const response: MCPPermissionsResponse = {
      chatId: chat.id,
      mcpPermissions: chat.mcpPermissions ?? [],
      mcpAllowedRepos: chat.mcpAllowedRepos ?? [],
    }

    return Response.json(response)
  } catch (error) {
    return internalError(error)
  }
}

// =============================================================================
// PATCH - Update MCP permissions for a chat
// =============================================================================

interface PatchMCPBody {
  /** MCP permissions to enable (e.g., ["github", "sentry"]) */
  mcpPermissions?: string[]
  /** Restrict GitHub MCP to specific repos (e.g., ["owner/repo1"]) */
  mcpAllowedRepos?: string[]
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ chatId: string }> }
): Promise<Response> {
  const authResult = await requireAuth()
  if (isAuthError(authResult)) return authResult
  const { userId } = authResult
  const { chatId } = await params

  try {
    const body: PatchMCPBody = await req.json()

    // Verify ownership
    const chat = await getChatWithAuth(chatId, userId)
    if (!chat) {
      return notFound("Chat not found")
    }

    // Build update data with validation
    const updateData: Record<string, unknown> = {}

    if (body.mcpPermissions !== undefined) {
      // Validate permissions
      if (!Array.isArray(body.mcpPermissions)) {
        return badRequest("mcpPermissions must be an array")
      }

      const invalidPermissions = body.mcpPermissions.filter(
        (p) => !VALID_MCP_PERMISSIONS.includes(p as MCPPermission)
      )
      if (invalidPermissions.length > 0) {
        return badRequest(
          `Invalid MCP permissions: ${invalidPermissions.join(", ")}. Valid values are: ${VALID_MCP_PERMISSIONS.join(", ")}`
        )
      }

      updateData.mcpPermissions = body.mcpPermissions
    }

    if (body.mcpAllowedRepos !== undefined) {
      // Validate repo format (should be "owner/repo")
      if (!Array.isArray(body.mcpAllowedRepos)) {
        return badRequest("mcpAllowedRepos must be an array")
      }

      const invalidRepos = body.mcpAllowedRepos.filter(
        (repo) => typeof repo !== "string" || !repo.includes("/")
      )
      if (invalidRepos.length > 0) {
        return badRequest(
          `Invalid repo format: ${invalidRepos.join(", ")}. Expected format: "owner/repo"`
        )
      }

      updateData.mcpAllowedRepos = body.mcpAllowedRepos
    }

    if (Object.keys(updateData).length === 0) {
      return badRequest("No valid fields to update")
    }

    const updatedChat = await prisma.chat.update({
      where: { id: chatId },
      data: updateData,
    })

    const response: MCPPermissionsResponse = {
      chatId: updatedChat.id,
      mcpPermissions: updatedChat.mcpPermissions ?? [],
      mcpAllowedRepos: updatedChat.mcpAllowedRepos ?? [],
    }

    return Response.json(response)
  } catch (error) {
    return internalError(error)
  }
}

// =============================================================================
// DELETE - Remove all MCP permissions from a chat
// =============================================================================

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ chatId: string }> }
): Promise<Response> {
  const authResult = await requireAuth()
  if (isAuthError(authResult)) return authResult
  const { userId } = authResult
  const { chatId } = await params

  try {
    // Verify ownership
    const chat = await getChatWithAuth(chatId, userId)
    if (!chat) {
      return notFound("Chat not found")
    }

    const updatedChat = await prisma.chat.update({
      where: { id: chatId },
      data: {
        mcpPermissions: [],
        mcpAllowedRepos: [],
      },
    })

    const response: MCPPermissionsResponse = {
      chatId: updatedChat.id,
      mcpPermissions: updatedChat.mcpPermissions ?? [],
      mcpAllowedRepos: updatedChat.mcpAllowedRepos ?? [],
    }

    return Response.json(response)
  } catch (error) {
    return internalError(error)
  }
}
