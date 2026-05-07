-- AlterTable: Add MCP (Model Context Protocol) permissions to Chat
-- Enables per-chat access control for external integrations like GitHub, Sentry, etc.

ALTER TABLE "Chat" ADD COLUMN "mcpPermissions" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Chat" ADD COLUMN "mcpAllowedRepos" TEXT[] DEFAULT ARRAY[]::TEXT[];
