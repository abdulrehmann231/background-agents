/**
 * MCP Proxy Endpoint - Smithery Integration
 *
 * This endpoint acts as a proxy between agents and Smithery's hosted MCP servers.
 * It looks up the user's GitHub token from the database and forwards requests
 * to Smithery's GitHub MCP server (https://github.run.tools).
 *
 * Security:
 * - Token is looked up from database (never sent by agent)
 * - Agent only provides sandboxId for authentication
 * - Token is passed to Smithery, never exposed to agent
 *
 * Flow:
 * 1. Agent connects to /api/mcp/[sandboxId]/sse
 * 2. Server looks up GitHub token from DB
 * 3. Server proxies MCP requests to https://github.run.tools with the token
 * 4. Smithery calls GitHub API and returns results
 * 5. Server forwards results to agent (token never visible to agent)
 */

import { NextRequest } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { parseMcpToolsConfig } from "@/lib/mcp/types"

// =============================================================================
// Constants
// =============================================================================

/** Smithery's GitHub MCP server URL */
const SMITHERY_GITHUB_MCP_URL = "https://github.run.tools"

// =============================================================================
// Types
// =============================================================================

interface McpRequest {
  jsonrpc: "2.0"
  id: string | number
  method: string
  params?: unknown
}

interface McpResponse {
  jsonrpc: "2.0"
  id: string | number
  result?: unknown
  error?: {
    code: number
    message: string
    data?: unknown
  }
}

interface ChatWithUser {
  id: string
  userId: string
  repo: string
  agent: string
  mcpTools: unknown
  user: {
    accounts: Array<{
      provider: string
      access_token: string | null
    }>
  }
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Look up chat by sandboxId and get user's GitHub token
 */
async function getChatAndToken(
  sandboxId: string
): Promise<{ chat: ChatWithUser; githubToken: string } | null> {
  const chat = await prisma.chat.findFirst({
    where: { sandboxId },
    include: {
      user: {
        include: {
          accounts: {
            where: { provider: "github" },
            select: {
              provider: true,
              access_token: true,
            },
          },
        },
      },
    },
  })

  if (!chat) return null

  const githubAccount = chat.user.accounts[0]
  if (!githubAccount?.access_token) return null

  return {
    chat: chat as ChatWithUser,
    githubToken: githubAccount.access_token,
  }
}

/**
 * Create MCP error response
 */
function mcpError(
  id: string | number,
  code: number,
  message: string
): McpResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message },
  }
}

/**
 * Proxy an MCP request to Smithery's GitHub MCP server
 */
async function proxyToSmithery(
  mcpRequest: McpRequest,
  githubToken: string
): Promise<McpResponse> {
  try {
    const response = await fetch(SMITHERY_GITHUB_MCP_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${githubToken}`,
      },
      body: JSON.stringify(mcpRequest),
    })

    if (!response.ok) {
      // Try to get error details from response
      let errorMessage = `Smithery error: ${response.status} ${response.statusText}`
      try {
        const errorBody = await response.json()
        if (errorBody.error_description) {
          errorMessage = errorBody.error_description
        } else if (errorBody.error) {
          errorMessage = errorBody.error
        }
      } catch {
        // Use default error message
      }
      return mcpError(mcpRequest.id, -32000, errorMessage)
    }

    const result = await response.json()
    return result as McpResponse
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    return mcpError(mcpRequest.id, -32000, `Failed to proxy to Smithery: ${message}`)
  }
}

// =============================================================================
// SSE Handler (for initial connection)
// =============================================================================

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sandboxId: string }> }
): Promise<Response> {
  const { sandboxId } = await params

  // 1. Look up chat and validate
  const result = await getChatAndToken(sandboxId)
  if (!result) {
    return new Response("Chat not found or GitHub not connected", { status: 404 })
  }

  const { chat } = result

  // 2. Check if MCP tools are enabled
  const mcpTools = parseMcpToolsConfig(chat.mcpTools)
  if (!mcpTools?.github) {
    return new Response("GitHub tools not enabled for this chat", { status: 403 })
  }

  // 3. Set up SSE stream
  const encoder = new TextEncoder()
  const stream = new TransformStream()
  const writer = stream.writable.getWriter()

  // Send SSE event
  const sendEvent = async (data: unknown) => {
    const json = JSON.stringify(data)
    await writer.write(encoder.encode(`data: ${json}\n\n`))
  }

  // Send server info on connection
  sendEvent({
    jsonrpc: "2.0",
    method: "server/info",
    params: {
      name: "daytona-mcp-proxy",
      version: "1.0.0",
      description: "Proxies to Smithery GitHub MCP server",
    },
  })

  return new Response(stream.readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  })
}

// =============================================================================
// POST Handler (for MCP JSON-RPC messages)
// =============================================================================

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sandboxId: string }> }
): Promise<Response> {
  const { sandboxId } = await params

  // 1. Look up chat and validate
  const result = await getChatAndToken(sandboxId)
  if (!result) {
    return Response.json(
      mcpError(0, -32001, "Chat not found or GitHub not connected"),
      { status: 404 }
    )
  }

  const { chat, githubToken } = result

  // 2. Check if MCP tools are enabled
  const mcpTools = parseMcpToolsConfig(chat.mcpTools)
  if (!mcpTools?.github) {
    return Response.json(
      mcpError(0, -32002, "GitHub tools not enabled for this chat"),
      { status: 403 }
    )
  }

  // 3. Parse MCP request
  let mcpRequest: McpRequest
  try {
    mcpRequest = await req.json()
  } catch {
    return Response.json(mcpError(0, -32700, "Parse error"), { status: 400 })
  }

  // 4. Handle notifications (no response needed)
  if (mcpRequest.method === "notifications/initialized") {
    return new Response(null, { status: 204 })
  }

  // 5. Proxy the request to Smithery's GitHub MCP server
  const response = await proxyToSmithery(mcpRequest, githubToken)

  // 6. Log for audit (without sensitive data)
  console.log(
    JSON.stringify({
      type: "mcp_request",
      timestamp: new Date().toISOString(),
      userId: chat.userId,
      chatId: chat.id,
      sandboxId,
      method: mcpRequest.method,
      tool: (mcpRequest.params as { name?: string })?.name,
      success: !response.error,
    })
  )

  return Response.json(response)
}
