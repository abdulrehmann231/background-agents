import { PrismaClient } from "@prisma/client"
import { PrismaNeon } from "@prisma/adapter-neon"
import { PrismaPg } from "@prisma/adapter-pg"
import pg from "pg"

import { recordDbOp } from "./metrics"

// Diagnostic instrumentation: count reads vs. durable writes per scoped window
// (see lib/db/metrics.ts). Applied as a client extension so it also captures
// queries issued from the cron's _lib helpers, which share this same client.
// Prisma v7 removed `$use` middleware, so we use a `$allOperations` extension.
function attachMetrics(client: PrismaClient) {
  return client.$extends({
    query: {
      $allOperations({ model, operation, args, query }) {
        recordDbOp(model, operation)
        return query(args)
      },
    },
  })
}

function createPrismaClient() {
  const isBuildTime = process.env.NEXT_PHASE === "phase-production-build"

  // At build time, use a placeholder URL - the client won't actually connect
  const connectionString = isBuildTime
    ? "postgresql://placeholder:placeholder@localhost:5432/placeholder"
    : (process.env.DATABASE_URL ?? process.env.POSTGRES_URL)

  if (!connectionString) {
    throw new Error(
      "DATABASE_URL or POSTGRES_URL environment variable is not set"
    )
  }

  // Use pg adapter for local PostgreSQL, Neon adapter for serverless PostgreSQL
  const isLocalPostgres =
    connectionString.includes("localhost") ||
    connectionString.includes("127.0.0.1")

  const client = isLocalPostgres
    ? new PrismaClient({
        adapter: new PrismaPg(new pg.Pool({ connectionString })),
        log:
          process.env.NODE_ENV === "development"
            ? ["error", "warn"]
            : ["error"],
      })
    : new PrismaClient({
        adapter: new PrismaNeon({ connectionString }),
        log:
          process.env.NODE_ENV === "development"
            ? ["error", "warn"]
            : ["error"],
      })

  return attachMetrics(client)
}

// The extended client type is inferred from createPrismaClient so callers keep
// full type safety for both base methods and the extension.
type ExtendedPrismaClient = ReturnType<typeof createPrismaClient>

declare global {
  // eslint-disable-next-line no-var
  var prisma: ExtendedPrismaClient | undefined
}

export const prisma = globalThis.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== "production") globalThis.prisma = prisma
