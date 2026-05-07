/**
 * MCP (Model Context Protocol) Server Configuration
 *
 * This module provides utilities for configuring MCP servers that give agents
 * access to external services like GitHub, Sentry, etc.
 *
 * MCP servers are configured per-chat based on permissions, ensuring that
 * only authorized chats can access specific integrations.
 */

export {
  buildMCPConfig,
  hasMCPPermission,
  validateMCPPermissions,
} from "./config"
export type { MCPServerConfig, MCPPermission } from "./config"
export { GITHUB_MCP_TOOLS } from "./github"
export type { GitHubMCPOptions } from "./github"
