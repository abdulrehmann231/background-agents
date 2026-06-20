/**
 * OpenAI Codex CLI Agent Definition
 */

import type {
  AgentDefinition,
  CommandSpec,
  ParseContext,
  RunOptions,
} from "../../core/agent"
import type { Event } from "../../types/events"
import type { CodeAgentSandbox } from "../../types/provider"
import { escapeShell, quote } from "../../utils/shell"
import { parseCodexLine } from "./parser"
import { CODEX_TOOL_MAPPINGS } from "./tools"
import { buildCodexConfigToml } from "./config"

/**
 * Codex agent-specific setup. Two mutually exclusive paths:
 *
 * 1. Custom endpoint — when CUSTOM_CODEX_BASE_URL is set (the user configured a
 *    custom OpenAI-compatible endpoint), write ~/.codex/config.toml routing all
 *    requests through that provider. Auth lives in the headers blob, so there is
 *    no `codex login` step.
 * 2. Standard OpenAI — remove any custom config.toml left over from a previous
 *    custom run in this sandbox (so a custom→standard switch stops routing to the
 *    old endpoint), then log in with the stored OPENAI_API_KEY.
 */
async function codexSetup(
  sandbox: CodeAgentSandbox,
  env: Record<string, string>
): Promise<void> {
  if (!sandbox.executeCommand) return

  if (env.CUSTOM_CODEX_BASE_URL) {
    const toml = buildCodexConfigToml({
      baseUrl: env.CUSTOM_CODEX_BASE_URL,
      model: env.CUSTOM_CODEX_NAME || undefined,
      headers: env.CUSTOM_CODEX_HEADERS || undefined,
      authHeaderEnv: env.CUSTOM_CODEX_AUTHORIZATION ? "CUSTOM_CODEX_AUTHORIZATION" : undefined,
    })
    // printf '%s' avoids backslash interpretation; quote() handles embedded quotes.
    await sandbox.executeCommand(
      `mkdir -p ~/.codex && printf '%s' ${quote(toml)} > ~/.codex/config.toml`,
      30
    )
    return
  }

  // Standard path: drop any custom config.toml from an earlier custom run in this
  // sandbox so it can't override the default provider. In this app config.toml is
  // only ever written by the custom path above, so removing it is safe.
  await sandbox.executeCommand(`rm -f ~/.codex/config.toml`, 10)

  if (!env.OPENAI_API_KEY) return

  const safeKey = escapeShell(env.OPENAI_API_KEY)
  await sandbox.executeCommand(
    `echo '${safeKey}' | codex login --with-api-key 2>&1`,
    30
  )
}

/**
 * OpenAI Codex CLI agent definition.
 *
 * Interacts with the Codex CLI tool which outputs JSON lines.
 */
export const codexAgent: AgentDefinition = {
  name: "codex",

  toolMappings: CODEX_TOOL_MAPPINGS,

  capabilities: {
    supportsSystemPrompt: false,
    supportsResume: true,
    supportsPlanMode: true,
    setup: codexSetup,
  },

  buildCommand(options: RunOptions): CommandSpec {
    const args: string[] = []

    // Use exec subcommand for non-interactive mode with JSON output
    args.push("exec")

    // JSON output for streaming events
    args.push("--json")

    // Skip git repo check for sandbox environments
    args.push("--skip-git-repo-check")

    if (options.planMode) {
      // Enable CLI-enforced plan mode (read-only)
      args.push("--sandbox", "read-only")
    } else {
      // Skip permission prompts when already running in a sandbox
      args.push("--yolo")
    }

    // Add model if specified (e.g., "gpt-4o", "o1", "o3")
    if (options.model) {
      args.push("--model", options.model)
    }

    // Resume session if provided
    if (options.sessionId) {
      args.push("resume", options.sessionId)
    }

    // The "--" sentinel signals end-of-options to the Codex CLI's argument parser
    if (options.prompt) {
      args.push("--")
      args.push(options.prompt)
    }

    return {
      cmd: "codex",
      args,
      env: options.env,
    }
  },

  parse(line: string, _context: ParseContext): Event | Event[] | null {
    return parseCodexLine(line, this.toolMappings)
  },
}
