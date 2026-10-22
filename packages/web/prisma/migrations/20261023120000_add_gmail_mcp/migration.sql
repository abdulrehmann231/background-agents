-- Gmail MCP: per-user Google refresh token and per-connection tool policy.
ALTER TABLE "User" ADD COLUMN "googleRefreshTokenEncrypted" TEXT;
ALTER TABLE "McpServerConnection" ADD COLUMN "toolPolicy" JSONB;
