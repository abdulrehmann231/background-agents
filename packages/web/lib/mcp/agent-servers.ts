/**
 * Load a chat's or scheduled job's connected MCP servers in the shape
 * `setupMcpForAgent` wants.
 *
 * Two kinds of rows:
 *   - Smithery rows  → decrypt the stored Smithery API key for the bearer.
 *   - GitHub row     → mint a fresh installation token via getInstallationToken
 *                      (tokens are 1-hour, so we re-mint on every turn instead
 *                      of trying to keep them in sync with the DB).
 *
 * Both ChatMcpServer and ScheduledJobMcpServer share a row shape; the shared
 * translator below handles either. On GitHub token mint failure we update the
 * row's `lastError`/`status` so the UI can surface "GitHub App uninstalled" on
 * the next form open — important for scheduled jobs that may run days after
 * being configured.
 */
import { prisma } from "@/lib/db/prisma"
import { decrypt } from "@/lib/db/encryption"
import {
  createGitHubMcpProvider,
  GITHUB_MCP_QUALIFIED_NAME,
  safeServerName,
} from "@upstream/mcp-providers"
import type { AgentMcpServer } from "@upstream/agent-configuration/mcp"

// Lazily-initialized GitHub provider
let githubProvider: ReturnType<typeof createGitHubMcpProvider> | null = null

function getGitHubProvider() {
  if (githubProvider) return githubProvider

  const appId = process.env.GITHUB_APP_ID
  const appSlug = process.env.GITHUB_APP_SLUG
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY

  if (!appId || !appSlug || !privateKey) {
    return null
  }

  githubProvider = createGitHubMcpProvider({ appId, appSlug, privateKey })
  return githubProvider
}

/**
 * Row shape common to ChatMcpServer and ScheduledJobMcpServer.
 */
interface McpRow {
  id: string
  qualifiedName: string
  mcpUrl: string | null
  encryptedApiKey: string | null
}

/**
 * Update the row's lastError/status. Tries the chat table first, falls back to
 * the job table. Best-effort — failure to record a warning shouldn't tank the
 * turn.
 */
async function markRowError(rowId: string, message: string): Promise<void> {
  try {
    const updated = await prisma.chatMcpServer.updateMany({
      where: { id: rowId },
      data: { status: "error", lastError: message },
    })
    if (updated.count > 0) return
    await prisma.scheduledJobMcpServer.updateMany({
      where: { id: rowId },
      data: { status: "error", lastError: message },
    })
  } catch (err) {
    console.error("[agent-servers] failed to mark row error:", err)
  }
}

/**
 * Translate one DB row to the AgentMcpServer shape the sandbox loader expects.
 * For Smithery rows: decrypt the stored bearer. For the GitHub sentinel: mint
 * a fresh installation token from the owning user's `githubAppInstallationId`.
 *
 * Returns null when the row can't produce a usable connection (e.g. App
 * uninstalled). On GitHub mint failure, the row's `lastError` is updated so
 * the user sees it on next form open.
 */
async function translateRow(
  row: McpRow,
  githubAppInstallationId: string | null
): Promise<AgentMcpServer | null> {
  if (!row.mcpUrl) return null

  if (row.qualifiedName === GITHUB_MCP_QUALIFIED_NAME) {
    const github = getGitHubProvider()
    if (!github) {
      await markRowError(row.id, "GitHub App not configured on server")
      return null
    }
    if (!githubAppInstallationId) {
      await markRowError(row.id, "GitHub App not installed for this user")
      return null
    }
    try {
      const token = await github.getToken(githubAppInstallationId)
      return {
        name: safeServerName(row.qualifiedName),
        url: row.mcpUrl,
        bearerToken: token,
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to mint token"
      console.error(
        "[agent-servers] failed to mint GitHub installation token:",
        err
      )
      await markRowError(row.id, `GitHub token mint failed: ${msg}`)
      return null
    }
  }

  if (!row.encryptedApiKey) return null
  return {
    name: safeServerName(row.qualifiedName),
    url: row.mcpUrl,
    bearerToken: decrypt(row.encryptedApiKey),
  }
}

export async function loadChatMcpServers(
  chatId: string
): Promise<AgentMcpServer[]> {
  const rows = await prisma.chatMcpServer.findMany({
    where: { chatId, status: "connected" },
    select: {
      id: true,
      qualifiedName: true,
      mcpUrl: true,
      encryptedApiKey: true,
      chat: { select: { user: { select: { githubAppInstallationId: true } } } },
    },
  })

  const out: AgentMcpServer[] = []
  for (const row of rows) {
    const installationId = row.chat.user.githubAppInstallationId
    const translated = await translateRow(row, installationId)
    if (translated) out.push(translated)
  }
  return out
}

/**
 * Load the MCP servers attached to a scheduled job. Same translation as for
 * chats; the difference is the FK column and the relation traversal up to the
 * owning user (for the GitHub installationId).
 */
export async function loadJobMcpServers(
  jobId: string
): Promise<AgentMcpServer[]> {
  const rows = await prisma.scheduledJobMcpServer.findMany({
    where: { jobId, status: "connected" },
    select: {
      id: true,
      qualifiedName: true,
      mcpUrl: true,
      encryptedApiKey: true,
      job: { select: { user: { select: { githubAppInstallationId: true } } } },
    },
  })

  const out: AgentMcpServer[] = []
  for (const row of rows) {
    const installationId = row.job.user.githubAppInstallationId
    const translated = await translateRow(row, installationId)
    if (translated) out.push(translated)
  }
  return out
}
