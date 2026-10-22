/**
 * Gmail MCP constants.
 */

/**
 * Sentinel qualifiedName for the Gmail MCP row in McpServerConnection. Unlike
 * GitHub, the server behind it is our own (see ./server.ts), hosted by the web
 * app, so there is no fixed URL constant here.
 */
export const GMAIL_MCP_QUALIFIED_NAME = "google/gmail"

export const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me"
