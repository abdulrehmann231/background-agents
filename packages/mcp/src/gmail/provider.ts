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
import { GMAIL_OAUTH_SCOPE } from "./constants"

export interface GmailMcpConfig {
  /** Google OAuth client ID. */
  clientId: string
  /** Google OAuth client secret. */
  clientSecret: string
  /** HMAC secret for agent connection tokens and OAuth `state`. */
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
/** OAuth `state` binds the Google callback to the user who started it. */
const OAUTH_STATE_TTL = "10m"
const OAUTH_STATE_AUDIENCE = "gmail-oauth-state"

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"

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
  signConnectionToken(connectionId: string): Promise<string> {
    return this.sign(connectionId, CONNECTION_TOKEN_AUDIENCE, CONNECTION_TOKEN_TTL)
  }

  /** Returns the connection id, or null if the token is invalid or expired. */
  verifyConnectionToken(token: string): Promise<string | null> {
    return this.verify(token, CONNECTION_TOKEN_AUDIENCE)
  }

  /** Sign the OAuth `state` for the user starting the Google consent flow. */
  signOAuthState(userId: string): Promise<string> {
    return this.sign(userId, OAUTH_STATE_AUDIENCE, OAUTH_STATE_TTL)
  }

  /** Returns the user id the state was issued to, or null if invalid. */
  verifyOAuthState(state: string): Promise<string | null> {
    return this.verify(state, OAUTH_STATE_AUDIENCE)
  }

  /**
   * Google consent URL. `prompt=consent` makes Google return a refresh token
   * even when the user has granted access before.
   */
  getAuthUrl(redirectUri: string, state: string): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: GMAIL_OAUTH_SCOPE,
      access_type: "offline",
      prompt: "consent",
      state,
    })
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`
  }

  /** Exchange the callback's authorization code for a refresh token. */
  async exchangeCode(code: string, redirectUri: string): Promise<string> {
    const data = await this.requestToken({
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    })
    if (!data.refresh_token) {
      throw new Error("Google did not return a refresh token")
    }
    return data.refresh_token
  }

  /** Revoke the grant at Google (best-effort cleanup on disconnect). */
  async revokeToken(refreshToken: string): Promise<void> {
    const res = await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      body: new URLSearchParams({ token: refreshToken }),
    })
    if (!res.ok) {
      throw new Error(`Google token revoke failed: ${res.status}`)
    }
  }

  /** Exchange the user's refresh token for a (cached) Google access token. */
  async getAccessToken(userId: string, refreshToken: string): Promise<string> {
    const cached = this.accessTokenCache.get(userId)
    if (cached && cached.expiresAt - Date.now() > REFRESH_BEFORE_MS) {
      return cached.token
    }
    const data = await this.requestToken({
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    })
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

  private async requestToken(
    params: Record<string, string>
  ): Promise<{ access_token: string; expires_in: number; refresh_token?: string }> {
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      body: new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        ...params,
      }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      throw new Error(`Google token request failed: ${res.status} ${body}`)
    }
    return (await res.json()) as {
      access_token: string
      expires_in: number
      refresh_token?: string
    }
  }

  private async sign(subject: string, audience: string, ttl: string): Promise<string> {
    return await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(subject)
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime(ttl)
      .sign(this.secret)
  }

  private async verify(token: string, audience: string): Promise<string | null> {
    try {
      const { payload } = await jwtVerify(token, this.secret, { audience })
      return payload.sub ?? null
    } catch {
      // Expected for expired/forged tokens; callers treat null as unauthorized.
      return null
    }
  }
}
