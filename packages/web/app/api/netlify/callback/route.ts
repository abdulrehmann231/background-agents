/**
 * GET /api/netlify/callback
 *
 * Where Netlify redirects after the user authorizes the app. We check the
 * OAuth `state`, exchange the code for a token, store it, and return a page
 * that closes the popup.
 *
 * Query params from Netlify:
 *   - code, state   on success
 *   - error         when the user declines
 */

import { NextRequest } from "next/server"
import { requireAuth, isAuthError } from "@/lib/db/api-helpers"
import {
  NETLIFY_STATE_COOKIE,
  netlifyPopupPage,
  netlifyRedirectUri,
  writeNetlifyToken,
} from "@/lib/server/netlify"

export async function GET(req: NextRequest): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return netlifyPopupPage(false, "You must be signed in to connect Netlify.")
  const { userId } = auth

  const params = new URL(req.url).searchParams
  const code = params.get("code")
  const state = params.get("state")
  if (!code || !state || state !== req.cookies.get(NETLIFY_STATE_COOKIE)?.value) {
    return netlifyPopupPage(false, "Netlify didn't finish connecting. Please try again.")
  }

  try {
    const res = await fetch("https://api.netlify.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: process.env.NETLIFY_OAUTH_CLIENT_ID ?? "",
        client_secret: process.env.NETLIFY_OAUTH_CLIENT_SECRET ?? "",
        redirect_uri: netlifyRedirectUri(),
      }),
    })
    if (!res.ok) throw new Error(`token exchange returned ${res.status}`)
    const { access_token } = (await res.json()) as { access_token?: string }
    if (!access_token) throw new Error("token exchange returned no access token")

    await writeNetlifyToken(userId, access_token)
    return netlifyPopupPage(true, "Netlify connected. You can return to the app.")
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error(`[netlify-callback] failed for user ${userId}: ${msg}`)
    return netlifyPopupPage(false, `Netlify connection failed: ${msg}`)
  }
}
