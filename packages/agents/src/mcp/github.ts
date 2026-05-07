/**
 * GitHub MCP Server Configuration
 *
 * Supports two authentication methods:
 * 1. Smithery (recommended) - Handles OAuth flow, token management
 * 2. Direct GitHub Token - For self-managed authentication
 *
 * The Smithery approach is preferred as it:
 * - Handles OAuth flow for you
 * - Manages token refresh automatically
 * - Never exposes credentials to the agent directly
 */

import type { MCPServerConfig } from "./config"

/**
 * GitHub MCP server options
 */
export interface GitHubMCPOptions {
  /**
   * Smithery API key for using Smithery's hosted GitHub MCP server
   * This is the recommended approach - Smithery handles OAuth
   */
  smitheryApiKey?: string

  /**
   * Direct GitHub personal access token or OAuth token
   * Use this if you're managing tokens yourself
   */
  githubToken?: string

  /**
   * Restrict GitHub access to specific repositories
   * Format: ["owner/repo1", "owner/repo2"]
   * Empty array = no restrictions (all repos user has access to)
   */
  allowedRepos?: string[]

  /**
   * GitHub API host for GitHub Enterprise
   * Default: https://api.github.com
   */
  githubHost?: string
}

/**
 * Available tools in the GitHub MCP server
 */
export const GITHUB_MCP_TOOLS = {
  // Issues
  search_issues: "Search for issues and pull requests",
  get_issue: "Get details of a specific issue",
  create_issue: "Create a new issue",
  update_issue: "Update an existing issue",
  add_issue_comment: "Add a comment to an issue",
  get_issue_comments: "Get comments on an issue",

  // Pull Requests
  get_pull_request: "Get details of a pull request",
  list_pull_requests: "List pull requests in a repository",
  create_pull_request: "Create a new pull request",
  create_pull_request_review: "Submit a review on a pull request",
  add_pull_request_review_comment: "Add a comment to a PR review",
  list_pull_request_reviews: "List reviews on a pull request",
  get_pull_request_diff: "Get the diff of a pull request",
  get_pull_request_files: "Get files changed in a pull request",

  // Repositories
  search_repositories: "Search for repositories",
  get_repository: "Get repository details",
  list_repository_issues: "List issues in a repository",

  // Users
  get_authenticated_user: "Get the authenticated user's info",
} as const

/**
 * Build GitHub MCP server configuration
 *
 * @param options - GitHub MCP options
 * @returns MCP server configuration or null if no valid auth provided
 */
export function buildGitHubMCPConfig(
  options: GitHubMCPOptions
): MCPServerConfig | null {
  // Prefer Smithery if API key is provided
  if (options.smitheryApiKey) {
    return buildSmitheryGitHubConfig(options)
  }

  // Fall back to direct GitHub token
  if (options.githubToken) {
    return buildDirectGitHubConfig(options)
  }

  // No valid authentication method
  return null
}

/**
 * Build configuration for Smithery-hosted GitHub MCP server
 */
function buildSmitheryGitHubConfig(options: GitHubMCPOptions): MCPServerConfig {
  const env: Record<string, string> = {
    SMITHERY_API_KEY: options.smitheryApiKey!,
  }

  // Pass allowed repos as environment variable for the MCP server to filter
  if (options.allowedRepos && options.allowedRepos.length > 0) {
    env.MCP_ALLOWED_REPOS = options.allowedRepos.join(",")
  }

  return {
    command: "npx",
    args: ["-y", "@smithery/cli@latest", "run", "@smithery-ai/github", "--key", options.smitheryApiKey!],
    env,
  }
}

/**
 * Build configuration for direct GitHub MCP server (self-managed token)
 */
function buildDirectGitHubConfig(options: GitHubMCPOptions): MCPServerConfig {
  const env: Record<string, string> = {
    GITHUB_PERSONAL_ACCESS_TOKEN: options.githubToken!,
  }

  // GitHub Enterprise support
  if (options.githubHost) {
    env.GITHUB_API_URL = options.githubHost
  }

  // Pass allowed repos
  if (options.allowedRepos && options.allowedRepos.length > 0) {
    env.MCP_ALLOWED_REPOS = options.allowedRepos.join(",")
  }

  return {
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    env,
  }
}

/**
 * Check if a repository is in the allowed list
 *
 * @param repo - Repository in "owner/repo" format
 * @param allowedRepos - List of allowed repositories
 * @returns true if repo is allowed or allowedRepos is empty
 */
export function isRepoAllowed(repo: string, allowedRepos: string[]): boolean {
  // Empty list means all repos are allowed
  if (!allowedRepos || allowedRepos.length === 0) {
    return true
  }

  // Normalize and check
  const normalizedRepo = repo.toLowerCase().trim()
  return allowedRepos.some(
    (allowed) => allowed.toLowerCase().trim() === normalizedRepo
  )
}
