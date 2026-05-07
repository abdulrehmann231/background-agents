/**
 * MCP Server Configuration Types and Builder
 *
 * Provides type-safe configuration for MCP servers with per-chat permission control.
 */

import { buildGitHubMCPConfig, type GitHubMCPOptions } from "./github"

/**
 * Available MCP permissions that can be granted to a chat
 */
export type MCPPermission = "github" | "sentry"

/**
 * MCP server configuration for spawning in a sandbox
 */
export interface MCPServerConfig {
  /** Command to run the MCP server */
  command: string
  /** Arguments for the command */
  args: string[]
  /** Environment variables for the MCP server */
  env: Record<string, string>
}

/**
 * Options for building MCP configuration
 */
export interface MCPConfigOptions {
  /** Permissions granted to this chat */
  permissions: MCPPermission[]

  /** GitHub-specific options (required if "github" permission is granted) */
  github?: GitHubMCPOptions

  /** Sentry-specific options (for future use) */
  sentry?: {
    /** Sentry auth token or use Smithery OAuth */
    authToken?: string
    /** Sentry organization slug */
    organization?: string
  }
}

/**
 * Build MCP server configurations based on chat permissions
 *
 * @param options - Configuration options including permissions and credentials
 * @returns Record of MCP server configurations keyed by server name
 *
 * @example
 * ```typescript
 * const mcpServers = buildMCPConfig({
 *   permissions: ["github"],
 *   github: {
 *     // Option 1: Use Smithery (recommended - handles OAuth)
 *     smitheryApiKey: process.env.SMITHERY_API_KEY,
 *
 *     // Option 2: Direct GitHub token
 *     // githubToken: userGitHubToken,
 *
 *     // Optional: restrict to specific repos
 *     allowedRepos: ["owner/repo1", "owner/repo2"],
 *   },
 * })
 * ```
 */
export function buildMCPConfig(
  options: MCPConfigOptions
): Record<string, MCPServerConfig> {
  const servers: Record<string, MCPServerConfig> = {}

  // GitHub MCP server
  if (options.permissions.includes("github") && options.github) {
    const githubConfig = buildGitHubMCPConfig(options.github)
    if (githubConfig) {
      servers.github = githubConfig
    }
  }

  // Sentry MCP server (future implementation)
  if (options.permissions.includes("sentry") && options.sentry) {
    // TODO: Implement Sentry MCP configuration
    // servers.sentry = buildSentryMCPConfig(options.sentry)
  }

  return servers
}

/**
 * Check if a chat has permission to use a specific MCP server
 */
export function hasMCPPermission(
  permissions: string[],
  requiredPermission: MCPPermission
): boolean {
  return permissions.includes(requiredPermission)
}

/**
 * Validate MCP permissions array
 */
export function validateMCPPermissions(permissions: string[]): MCPPermission[] {
  const validPermissions: MCPPermission[] = ["github", "sentry"]
  return permissions.filter((p) =>
    validPermissions.includes(p as MCPPermission)
  ) as MCPPermission[]
}
