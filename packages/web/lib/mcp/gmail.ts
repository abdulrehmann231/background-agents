/**
 * Shared Gmail MCP provider for the web app: signs/verifies the connection
 * tokens agents use and refreshes Google access tokens. Returns null when the
 * Google OAuth env vars aren't configured.
 */
import { createGmailMcpProvider, type GmailMcpProvider } from "@background-agents/mcp"

let gmailProvider: GmailMcpProvider | null = null

export function getGmailProvider(): GmailMcpProvider | null {
  if (gmailProvider) return gmailProvider

  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  const jwtSecret = process.env.GMAIL_MCP_JWT_SECRET

  if (!clientId || !clientSecret || !jwtSecret) {
    return null
  }

  gmailProvider = createGmailMcpProvider({ clientId, clientSecret, jwtSecret })
  return gmailProvider
}
