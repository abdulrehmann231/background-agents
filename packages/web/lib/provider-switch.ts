/**
 * Reactive provider auto-switch.
 *
 * When a turn ends because the upstream provider reported its own limit is
 * exhausted (Claude 5-hour / weekly cap, OpenCode Go usage cap, Codex/Gemini
 * quota), this restarts the same turn on the next available provider — on the
 * same sandbox, with the prior conversation injected as history so context
 * carries over — and records a small inline notice.
 *
 * It is the side-effecting counterpart to the pure {@link pickFallbackAgent}
 * policy. The streaming route calls it from its terminal-state handler.
 */

import { nanoid } from "nanoid"
import type { Sandbox as DaytonaSandbox } from "@daytonaio/sdk"

import { prisma } from "@/lib/db/prisma"
import { PATHS } from "@/lib/constants"
import { NEW_REPOSITORY } from "@/lib/types"
import { getUserCredentials } from "@/lib/db/api-helpers"
import { getClaudeCredentials } from "@/lib/claude-credentials"
import { getEffectiveCredentialFlags } from "@/lib/server/credential-flags"
import { createBackgroundAgentSession } from "@/lib/agent-session"
import { loadMcpConnections } from "@/lib/mcp/agent-servers"
import { discoverSkillsForRepo } from "@/lib/sandbox"
import { pickFallbackAgent, FALLBACK_CHAIN } from "@/lib/provider-fallback"
import { switchNoticeContent } from "@/lib/provider-limit"
import { getEnvForModel, type Agent } from "@background-agents/common"

export interface ProviderSwitchResult {
  /** Background session id for the newly started provider. */
  backgroundSessionId: string
  agent: Agent
  model: string
  fromAgent: Agent
  /** Id of the inline notice message persisted for the switch. */
  noticeMessageId: string
  /** Timestamp (ms) the restarted assistant message was bumped to, so the
   *  client can reset it and keep the notice ordered immediately above it. */
  assistantTimestamp: number
}

export interface AttemptProviderSwitchArgs {
  sandbox: DaytonaSandbox
  chatId: string
  userId: string
  /** Agent whose turn just failed with a provider-limit error. */
  fromAgent: Agent
  /** The assistant message being streamed; reused for the new provider's output. */
  assistantMessageId: string
  /** Providers already tried this turn — mutated to include `fromAgent`. */
  exhausted: Set<Agent>
  previewUrlPattern?: string | null
}

/** Only these agents participate in auto-switch (matches the fallback chain). */
export function isSwitchableAgent(agent: string): agent is Agent {
  return (FALLBACK_CHAIN as readonly string[]).includes(agent)
}

/**
 * Try to continue the turn on the next available provider. Returns the new
 * session details on success, or null when no fallback is available (the caller
 * should then finalize the original limit error).
 */
export async function attemptProviderSwitch(
  args: AttemptProviderSwitchArgs
): Promise<ProviderSwitchResult | null> {
  const {
    sandbox,
    chatId,
    userId,
    fromAgent,
    assistantMessageId,
    exhausted,
    previewUrlPattern,
  } = args

  // Availability is computed from effective flags so user keys AND shared pools
  // are both honored. A provider whose app-side pool is also tapped out won't
  // be offered (its flag reflects that).
  const { flags } = await getEffectiveCredentialFlags(userId)
  exhausted.add(fromAgent)

  const pick = pickFallbackAgent({ requested: fromAgent, flags, exhausted })
  if (!pick) {
    console.log(
      `[provider-switch] No fallback available after ${fromAgent} (exhausted: ${[...exhausted].join(", ")})`
    )
    return null
  }

  // Resolve credentials for the new provider, injecting the shared Claude pool
  // blob when falling back to Claude Code without the user's own token.
  let credentials = await getUserCredentials(userId)
  if (pick.agent === "claude-code" && !credentials.CLAUDE_CODE_CREDENTIALS) {
    try {
      credentials = {
        ...credentials,
        CLAUDE_CODE_CREDENTIALS: await getClaudeCredentials(),
      }
    } catch (err) {
      // Pool unavailable — pickFallbackAgent shouldn't have chosen claude here,
      // but be defensive and bail rather than start a keyless Claude session.
      console.error("[provider-switch] shared Claude pool unavailable:", err)
      return null
    }
  }
  const env = getEnvForModel(pick.model, pick.agent, credentials)

  // Reconstruct the prompt that triggered this turn and the history before it.
  const messages = await prisma.message.findMany({
    where: { chatId },
    orderBy: { timestamp: "asc" },
    select: { id: true, role: true, content: true },
  })
  const assistantIdx = messages.findIndex((m) => m.id === assistantMessageId)
  const searchEnd = assistantIdx === -1 ? messages.length : assistantIdx
  let promptIdx = -1
  for (let i = searchEnd - 1; i >= 0; i--) {
    if (messages[i].role === "user" && messages[i].content.trim()) {
      promptIdx = i
      break
    }
  }
  if (promptIdx === -1) {
    console.error("[provider-switch] could not find triggering user prompt")
    return null
  }
  const prompt = messages[promptIdx].content
  const history = messages
    .slice(0, promptIdx)
    .filter(
      (m): m is typeof m & { role: "user" | "assistant" } =>
        (m.role === "user" || m.role === "assistant") && !!m.content.trim()
    )
    .map((m) => ({ role: m.role, content: m.content }))

  // Carry over the chat's MCP servers and installed skills so the fallback
  // provider runs with the same tools/skills as the original turn. Both are
  // best-effort — a failure here must not block the switch.
  const repoPath = `${PATHS.SANDBOX_HOME}/project`
  let mcpServers: Awaited<ReturnType<typeof loadMcpConnections>> = []
  try {
    mcpServers = await loadMcpConnections({ kind: "chat", id: chatId })
  } catch (err) {
    console.error("[provider-switch] loadMcpConnections failed:", err)
  }

  let skills: Awaited<ReturnType<typeof discoverSkillsForRepo>> = []
  const chatRow = await prisma.chat.findUnique({
    where: { id: chatId },
    select: { repo: true },
  })
  if (chatRow && chatRow.repo !== NEW_REPOSITORY) {
    skills = await discoverSkillsForRepo(sandbox, repoPath)
  }

  // Start the new provider on the SAME sandbox. Fresh session id (the new CLI
  // would reject the old provider's session), history injected for context.
  const bg = await createBackgroundAgentSession(sandbox, {
    repoPath,
    previewUrlPattern: previewUrlPattern ?? undefined,
    agent: pick.agent,
    model: pick.model,
    env: Object.keys(env).length > 0 ? env : undefined,
    mcpServers,
    skills: skills.length > 0 ? skills : undefined,
  })
  await bg.start(prompt, history.length > 0 ? { history } : undefined)

  // Persist: inline notice + reset the assistant message to stream the new
  // provider's output + repoint the chat to the new provider/session.
  // Timestamps are bumped so the notice sorts immediately before the (restarted)
  // assistant message, both after the user prompt.
  const now = Date.now()
  const noticeId = nanoid()

  await prisma.$transaction([
    prisma.message.create({
      data: {
        id: noticeId,
        chatId,
        role: "assistant",
        content: switchNoticeContent(fromAgent, pick.agent, pick.model),
        timestamp: BigInt(now),
        messageType: "provider-switch",
        agent: pick.agent,
        model: pick.model,
      },
    }),
    prisma.message.update({
      where: { id: assistantMessageId },
      data: {
        agent: pick.agent,
        model: pick.model,
        content: "",
        toolCalls: [],
        contentBlocks: [],
        isError: false,
        timestamp: BigInt(now + 1),
      },
    }),
    prisma.chat.update({
      where: { id: chatId },
      data: {
        agent: pick.agent,
        model: pick.model,
        backgroundSessionId: bg.backgroundSessionId,
        sessionId: null,
        status: "running",
      },
    }),
  ])

  console.log(
    `[provider-switch] ${fromAgent} → ${pick.agent} (${pick.model}) for chat ${chatId}`
  )

  return {
    backgroundSessionId: bg.backgroundSessionId,
    agent: pick.agent,
    model: pick.model,
    fromAgent,
    noticeMessageId: noticeId,
    assistantTimestamp: now + 1,
  }
}
