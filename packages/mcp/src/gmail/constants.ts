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

/**
 * gmail.modify covers read, draft, send and relabel (but not permanent delete).
 * We request it once and narrow per connection with the tool policy, which is
 * enforced server-side — the agent never holds the Google token.
 */
export const GMAIL_OAUTH_SCOPE = "https://www.googleapis.com/auth/gmail.modify"
