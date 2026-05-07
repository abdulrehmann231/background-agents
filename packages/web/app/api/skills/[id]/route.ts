import { prisma } from "@/lib/db/prisma"
import {
  requireAuth,
  isAuthError,
  notFound,
  internalError,
} from "@/lib/db/api-helpers"

// =============================================================================
// DELETE - Uninstall a skill by ID
// =============================================================================

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const authResult = await requireAuth()
  if (isAuthError(authResult)) return authResult
  const { userId } = authResult
  const { id } = await params

  try {
    // Verify ownership before deleting
    const skill = await prisma.skill.findUnique({
      where: { id },
      select: { userId: true },
    })

    if (!skill || skill.userId !== userId) {
      return notFound("Skill not found")
    }

    await prisma.skill.delete({ where: { id } })

    return Response.json({ success: true })
  } catch (error) {
    return internalError(error)
  }
}
