/**
 * Gmail MCP provider — connection tokens + Google access tokens.
 *
 * The agent gets a short-lived JWT naming its McpServerConnection row, signed
 * with our own secret. Our MCP server verifies it, looks up the row's policy
 * and the owner's Google refresh token, and only then talks to Gmail. The
 * agent never sees a Google credential, so it can't bypass the policy by
 * calling the Gmail API directly.
 */

import { SignJWT, jwtVerify } from "jose"

export interface GmailMcpConfig {
  /** Google OAuth client ID. */
  clientId: string
  /** Google OAuth client secret. */
  clientSecret: string
  /** HMAC secret for signing connection tokens handed to the agent. */
  jwtSecret: string
}

interface AccessToken {
  token: string
  /** ms-epoch when Google will reject this token. */
  expiresAt: number
}

/** Matches the GitHub provider: refresh 5 minutes before expiry. */
const REFRESH_BEFORE_MS = 5 * 60 * 1000

/** Connection tokens are minted per agent turn; an hour covers a long turn. */
const CONNECTION_TOKEN_TTL = "1h"
const CONNECTION_TOKEN_AUDIENCE = "gmail-mcp"

export function createGmailMcpProvider(config: GmailMcpConfig): GmailMcpProvider {
  return new GmailMcpProvider(config)
}

export class GmailMcpProvider {
  private readonly config: GmailMcpConfig
  private readonly secret: Uint8Array
  private readonly accessTokenCache = new Map<string, AccessToken>()

  constructor(config: GmailMcpConfig) {
    this.config = config
    this.secret = new TextEncoder().encode(config.jwtSecret)
  }

  /** Sign the bearer token the agent uses to call our Gmail MCP server. */
  async signConnectionToken(connectionId: string): Promise<string> {
    return await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(connectionId)
      .setAudience(CONNECTION_TOKEN_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(CONNECTION_TOKEN_TTL)
      .sign(this.secret)
  }

  /** Returns the connection id, or null if the token is invalid or expired. */
  async verifyConnectionToken(token: string): Promise<string | null> {
    try {
      const { payload } = await jwtVerify(token, this.secret, {
        audience: CONNECTION_TOKEN_AUDIENCE,
      })
      return payload.sub ?? null
    } catch {
      // Expected for expired/forged tokens; the caller answers 401.
      return null
    }
  }

  /** Exchange the user's refresh token for a (cached) Google access token. */
  async getAccessToken(userId: string, refreshToken: string): Promise<string> {
    const cached = this.accessTokenCache.get(userId)
    if (cached && cached.expiresAt - Date.now() > REFRESH_BEFORE_MS) {
      return cached.token
    }
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      body: new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      throw new Error(`Google token refresh failed: ${res.status} ${body}`)
    }
    const data = (await res.json()) as { access_token: string; expires_in: number }
    this.accessTokenCache.set(userId, {
      token: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    })
    return data.access_token
  }

  /** Drop a cached access token — used after disconnect. */
  invalidateAccessToken(userId: string): void {
    this.accessTokenCache.delete(userId)
  }
}
