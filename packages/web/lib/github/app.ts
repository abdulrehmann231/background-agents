/**
 * GitHub App helpers — JWT signing + installation access tokens.
 *
 * The app points the agent at GitHub's hosted MCP server
 * (api.githubcopilot.com/mcp/) and authenticates with a short-lived
 * installation access token minted from our App. The agent never sees the
 * App private key, only the per-request bearer token.
 *
 * Tokens are cached in-process by installationId and re-minted lazily before
 * expiry. We mint a fresh token at the start of each agent turn (where the
 * caller plugs it into the per-agent MCP config), so the 5-min refresh slack
 * here is purely a safety net against handing out an about-to-expire token.
 */

import { SignJWT } from "jose"
import { createPrivateKey, type KeyObject } from "crypto"

interface InstallationToken {
  token: string
  /** ms-epoch when GitHub will reject this token. */
  expiresAt: number
}

const tokenCache = new Map<string, InstallationToken>()

const REFRESH_BEFORE_MS = 5 * 60 * 1000

function readEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`${name} is not set`)
  return v
}

/**
 * Parse the App private key. Accepts:
 *   - single-line PEM with literal `\n` between rows (typical .env style)
 *   - real multi-line PEM (some env loaders)
 * Node's createPrivateKey accepts both PKCS#1 and PKCS#8.
 */
let _cachedKey: KeyObject | null = null
function getPrivateKey(): KeyObject {
  if (_cachedKey) return _cachedKey
  const raw = readEnv("GITHUB_APP_PRIVATE_KEY")
  const pem = raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw
  _cachedKey = createPrivateKey({ key: pem, format: "pem" })
  return _cachedKey
}

/**
 * Sign a 9-minute JWT identifying our GitHub App. GitHub's hard limit is
 * 10 minutes; we leave a minute of slack and backdate `iat` 60s for clock
 * skew.
 */
async function signAppJwt(): Promise<string> {
  const key = getPrivateKey()
  const now = Math.floor(Date.now() / 1000)
  return await new SignJWT({})
    .setProtectedHeader({ alg: "RS256" })
    .setIssuedAt(now - 60)
    .setExpirationTime(now + 540)
    .setIssuer(readEnv("GITHUB_APP_ID"))
    .sign(key)
}

/**
 * Exchange the App JWT for a 1-hour installation access token. This token is
 * what the agent's tool calls actually use against api.githubcopilot.com.
 */
async function mintInstallationToken(
  installationId: string
): Promise<InstallationToken> {
  const jwt = await signAppJwt()
  const res = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    }
  )
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(
      `GitHub installation token request failed: ${res.status} ${body}`
    )
  }
  const data = (await res.json()) as { token: string; expires_at: string }
  return {
    token: data.token,
    expiresAt: new Date(data.expires_at).getTime(),
  }
}

/**
 * Get a fresh installation token. Refreshes lazily when within
 * REFRESH_BEFORE_MS of expiry so callers never get an about-to-die token.
 */
export async function getInstallationToken(
  installationId: string
): Promise<string> {
  const cached = tokenCache.get(installationId)
  const now = Date.now()
  if (cached && cached.expiresAt - now > REFRESH_BEFORE_MS) {
    return cached.token
  }
  const fresh = await mintInstallationToken(installationId)
  tokenCache.set(installationId, fresh)
  return fresh.token
}

/** Drop a cached token — used after disconnect. */
export function invalidateInstallationToken(installationId: string): void {
  tokenCache.delete(installationId)
}

/**
 * GitHub's hosted MCP server. Accepts `Authorization: Bearer <installation-
 * token>` and exposes issues, PRs, repos, code search, etc.
 */
export const GITHUB_MCP_URL = "https://api.githubcopilot.com/mcp/"

/** Sentinel qualifiedName we use for the GitHub MCP row in ChatMcpServer. */
export const GITHUB_MCP_QUALIFIED_NAME = "github/github"

/** Public app slug used to build the install URL. */
function getAppSlug(): string {
  return readEnv("GITHUB_APP_SLUG")
}

/** Where to send the user to install/authorize the App. */
export function getInstallUrl(): string {
  return `https://github.com/apps/${getAppSlug()}/installations/new`
}
