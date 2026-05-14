-- AlterTable: capture the user's GitHub App installation
-- IF NOT EXISTS keeps this migration idempotent across DBs that already had
-- this column from an earlier branch.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "githubAppInstallationId" TEXT;

-- AlterTable: allow non-Smithery rows (e.g. GitHub MCP) in ChatMcpServer.
-- DROP NOT NULL is itself idempotent — Postgres accepts it on already-nullable
-- columns without error.
ALTER TABLE "ChatMcpServer" ALTER COLUMN "smitheryConnectionId" DROP NOT NULL;
ALTER TABLE "ChatMcpServer" ALTER COLUMN "smitheryNamespace" DROP NOT NULL;
