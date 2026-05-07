/**
 * Claude Code CLI Agent Definition
 */

import type { AgentDefinition, CommandSpec, MCPServerSpec, ParseContext, RunOptions } from "../../core/agent"
import type { CodeAgentSandbox } from "../../types/provider"
import type { Event } from "../../types/events"
import { parseClaudeLine } from "./parser"
import { CLAUDE_TOOL_MAPPINGS } from "./tools"

/** Claude credentials directory */
const CLAUDE_CREDENTIALS_DIR = "/home/daytona/.claude"
/** Claude credentials file */
const CLAUDE_CREDENTIALS_FILE = "/home/daytona/.claude/.credentials.json"
/** Claude MCP settings file */
const CLAUDE_MCP_SETTINGS_FILE = "/home/daytona/.claude/settings.json"
/** Environment variable name for Claude Code credentials */
const CLAUDE_CODE_CREDENTIALS_ENV = "CLAUDE_CODE_CREDENTIALS"

/**
 * Build MCP settings JSON for Claude Code
 *
 * Claude Code reads MCP server configuration from ~/.claude/settings.json
 * Format: { "mcpServers": { "serverName": { "command": "...", "args": [...], "env": {...} } } }
 */
function buildMCPSettingsJson(mcpServers: Record<string, MCPServerSpec>): string {
  const settings = {
    mcpServers: Object.fromEntries(
      Object.entries(mcpServers).map(([name, config]) => [
        name,
        {
          command: config.command,
          args: config.args,
          env: config.env,
        },
      ])
    ),
  }
  return JSON.stringify(settings, null, 2)
}

/**
 * Claude agent-specific setup: write credentials and MCP configuration.
 *
 * When CLAUDE_CODE_CREDENTIALS environment variable is set, this function
 * writes its contents to ~/.claude/.credentials.json. This allows credentials
 * to be passed via environment variable instead of writing the file manually.
 *
 * When MCP servers are configured, it writes the configuration to
 * ~/.claude/settings.json for Claude Code to use.
 *
 * The credentials value should be the JSON content of the credentials file, e.g.:
 * {"claudeAiOauth":{"accessToken":"sk-ant-oa..."}}
 */
async function claudeSetup(
  sandbox: CodeAgentSandbox,
  env: Record<string, string>
): Promise<void> {
  if (!sandbox.executeCommand) return

  // Create directory first
  await sandbox.executeCommand(
    `mkdir -p '${CLAUDE_CREDENTIALS_DIR}'`,
    30
  )

  // Write credentials if provided
  const credentialsJson = env[CLAUDE_CODE_CREDENTIALS_ENV]
  if (credentialsJson) {
    // Escape single quotes for shell command
    const safeCredentials = credentialsJson.replace(/'/g, "'\\''")
    await sandbox.executeCommand(
      `echo '${safeCredentials}' > '${CLAUDE_CREDENTIALS_FILE}' && chmod 600 '${CLAUDE_CREDENTIALS_FILE}'`,
      30
    )
  }
}

/**
 * Write MCP server configuration to Claude settings file
 *
 * This is called separately from setup() because MCP servers are passed
 * via RunOptions, not environment variables.
 */
async function writeMCPSettings(
  sandbox: CodeAgentSandbox,
  mcpServers: Record<string, MCPServerSpec>
): Promise<void> {
  if (!sandbox.executeCommand || Object.keys(mcpServers).length === 0) return

  const settingsJson = buildMCPSettingsJson(mcpServers)
  const safeSettings = settingsJson.replace(/'/g, "'\\''")

  // Create directory and write settings file
  await sandbox.executeCommand(
    `mkdir -p '${CLAUDE_CREDENTIALS_DIR}' && echo '${safeSettings}' > '${CLAUDE_MCP_SETTINGS_FILE}' && chmod 600 '${CLAUDE_MCP_SETTINGS_FILE}'`,
    30
  )
}

/**
 * Minimal sandbox interface for MCP configuration.
 * Only requires executeCommand capability.
 */
export interface MCPConfigSandbox {
  executeCommand: (
    command: string,
    timeout?: number
  ) => Promise<string | { exitCode: number; output: string }>
}

/**
 * Configure MCP servers for a Claude agent session
 *
 * Call this before starting an agent session to enable MCP integrations.
 * This writes the MCP configuration to ~/.claude/settings.json
 *
 * @example
 * ```typescript
 * import { configureMCPServers } from "background-agents/agents/claude"
 * import { buildMCPConfig } from "background-agents/mcp"
 *
 * const mcpServers = buildMCPConfig({
 *   permissions: ["github"],
 *   github: { smitheryApiKey: process.env.SMITHERY_API_KEY },
 * })
 *
 * // Works with any sandbox that has executeCommand
 * await configureMCPServers(sandbox, mcpServers)
 * ```
 */
export async function configureMCPServers(
  sandbox: MCPConfigSandbox,
  mcpServers: Record<string, MCPServerSpec>
): Promise<void> {
  if (Object.keys(mcpServers).length === 0) return

  const settingsJson = buildMCPSettingsJson(mcpServers)
  const safeSettings = settingsJson.replace(/'/g, "'\\''")

  // Create directory and write settings file
  await sandbox.executeCommand(
    `mkdir -p '${CLAUDE_CREDENTIALS_DIR}' && echo '${safeSettings}' > '${CLAUDE_MCP_SETTINGS_FILE}' && chmod 600 '${CLAUDE_MCP_SETTINGS_FILE}'`,
    30
  )
}

/**
 * Claude Code CLI agent definition.
 *
 * Interacts with the Claude CLI tool which outputs JSON lines in stream-json format.
 */
export const claudeAgent: AgentDefinition = {
  name: "claude",

  toolMappings: CLAUDE_TOOL_MAPPINGS,

  capabilities: {
    supportsSystemPrompt: true,
    supportsResume: true,
    supportsMCP: true,
    setup: claudeSetup,
  },

  buildCommand(options: RunOptions): CommandSpec {
    const args: string[] = []

    // Print mode for non-interactive usage
    args.push("-p")

    // Add output format flag for JSON streaming (requires --verbose)
    args.push("--output-format", "stream-json", "--verbose")

    // Skip permission prompts when already running in a sandbox
    args.push("--dangerously-skip-permissions")

    // Apply system prompt via native CLI flag when provided
    if (options.systemPrompt) {
      args.push("--system-prompt", options.systemPrompt)
    }

    // Add model if specified (e.g., "sonnet", "opus", "claude-sonnet-4-5-20250929")
    if (options.model) {
      args.push("--model", options.model)
    }

    // Resume session if provided
    if (options.sessionId) {
      args.push("--resume", options.sessionId)
    }

    // Enable extended thinking when plan mode is active
    if (options.planMode) {
      args.push("--settings", JSON.stringify({ alwaysThinkingEnabled: true }))
    }

    // The "--" sentinel signals end-of-options to the Claude CLI's argument parser
    if (options.prompt) {
      args.push("--")
      args.push(options.prompt)
    }

    return {
      cmd: "claude",
      args,
      env: options.env,
    }
  },

  parse(line: string, _context: ParseContext): Event | Event[] | null {
    return parseClaudeLine(line, this.toolMappings)
  },
}
