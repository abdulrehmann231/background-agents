/**
 * Netlify connection used to deploy a repo.
 *
 * The OAuth token is stored encrypted in User.credentials like the other
 * server-managed credentials. It is only used here on the server: it's never
 * returned to the client and never injected into a sandbox.
 */
import "server-only"
import type { CredentialId } from "@background-agents/common"
import { encrypt } from "@/lib/db/encryption"
import { normalizeStoredCredentials } from "@/lib/credentials"
import { escapeHtml } from "@/lib/html"
import { withUserLock } from "./codex-credentials"

const CREDENTIAL_KEY: CredentialId = "NETLIFY_OAUTH_TOKEN"

/** Cookie holding the OAuth `state` between /connect and /callback. */
export const NETLIFY_STATE_COOKIE = "netlify_oauth_state"

/** Must match the redirect URI registered on the Netlify OAuth application. */
export function netlifyRedirectUri(): string {
  const base = (process.env.NEXTAUTH_URL ?? "http://localhost:4000").replace(/\/$/, "")
  return `${base}/api/netlify/callback`
}

/** Store the user's Netlify token, or remove it when `token` is null. */
export async function writeNetlifyToken(userId: string, token: string | null): Promise<void> {
  await withUserLock(userId, async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { credentials: true } })
    const stored = normalizeStoredCredentials(user?.credentials as Record<string, unknown> | null)
    if (token) {
      stored[CREDENTIAL_KEY] = encrypt(token)
    } else {
      delete stored[CREDENTIAL_KEY]
    }
    await tx.user.update({ where: { id: userId }, data: { credentials: stored as never } })
  })
}

/**
 * Page shown in the connect popup. On success it closes itself, and Settings
 * refreshes once the popup is gone; on failure it stays open so the message
 * can be read.
 */
export function netlifyPopupPage(ok: boolean, message: string): Response {
  const body = `<!doctype html>
<html><head><meta charset="utf-8"><title>Netlify ${ok ? "connected" : "connection failed"}</title></head>
<body style="font: 14px system-ui, sans-serif; padding: 24px; color: ${ok ? "#1a7f37" : "#cf222e"}">
  <p>${escapeHtml(message)}</p>
  ${ok ? `<script>setTimeout(function () { try { window.close(); } catch (e) {} }, 800)</script>` : "<p>You can close this window.</p>"}
</body></html>`
  return new Response(body, {
    status: ok ? 200 : 400,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  })
}
