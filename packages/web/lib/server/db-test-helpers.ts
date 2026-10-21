import { describe } from "vitest"

/**
 * Runs a describe block only when a real test database is configured
 * (DATABASE_URL set); skips it otherwise. Every `*.integration.test.ts` file
 * in this directory that touches Prisma should wrap its top-level describe
 * in this instead of a bare `describe`.
 */
export const databaseDescribe = process.env.DATABASE_URL ? describe : describe.skip

type PrismaClient = typeof import("@/lib/db/prisma").prisma

/**
 * Create a throwaway user for an integration suite to own its fixtures
 * (chats, messages, etc.) under. Call from `beforeAll` and assign the result
 * to your file's own `prisma`/`userId` variables — every test body in these
 * suites already reads those two directly, so this only replaces the
 * repeated setup line, not the call sites.
 */
export async function createTestUser(
  emailPrefix: string
): Promise<{ prisma: PrismaClient; userId: string }> {
  const { prisma } = await import("@/lib/db/prisma")
  const userId = (
    await prisma.user.create({
      data: { email: `${emailPrefix}-${crypto.randomUUID()}@example.test` },
    })
  ).id
  return { prisma, userId }
}

/**
 * Delete the throwaway user created by `createTestUser` and close the
 * connection. Call from `afterAll`. Safe to call even if `beforeAll` failed
 * before `prisma`/`userId` were assigned.
 */
export async function deleteTestUser(
  prisma: PrismaClient | undefined,
  userId: string | undefined
): Promise<void> {
  if (userId) await prisma?.user.delete({ where: { id: userId } })
  await prisma?.$disconnect()
}
