/**
 * @background-agents/agent-configuration
 *
 * A translation layer between coding agents' configuration formats.
 *
 * Each supported agent (Claude Code, Codex, Gemini, OpenCode, Goose, Copilot,
 * Kilo, Kimi) loads MCP servers and command-permission rules from a different
 * file in a different schema. This package takes agent-agnostic inputs — a list
 * of MCP servers, a command-permission policy — and renders the correct native
 * config for whichever agent is running, then installs it into the sandbox.
 *
 * You supply the inputs; the package handles the per-agent formats. The command
 * ruleset itself (e.g. which git operations to block) stays in your app and is
 * passed in, so one policy renders identically across every agent.
 *
 * @example
 * ```ts
 * import {
 *   setupMcpForAgent,
 *   setupClaudePermissions,
 *   renderOpenCodePermissionEnv,
 * } from '@background-agents/agent-configuration'
 *
 * await setupMcpForAgent(sandbox, { agent, servers })
 * await setupClaudePermissions(sandbox, policy)
 * ```
 */

// Command-permission translation (Claude hook / Codex rules / OpenCode env).
export * from "./permissions"

// MCP server config translation.
export * from "./mcp"
