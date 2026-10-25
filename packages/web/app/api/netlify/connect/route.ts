/**
 * /api/netlify/connect
 *
 * GET    → start Netlify's OAuth flow. Settings opens this in a popup; the
 *          flow finishes in /api/netlify/callback.
 * DELETE → forget the user's Netlify token. The authorization itself is
 *          revoked from the user's Netlify account (Applications page).
 */

import { randomUUID } from "node:crypto"
import { NextResponse } from "next/server"
import { requireAuth, isAuthError, internalError } from "@/lib/db/api-helpers"
import {
  NETLIFY_STATE_COOKIE,
  netlifyPopupPage,
  netlifyRedirectUri,
  writeNetlifyToken,
} from "@/lib/server/netlify"

export async function GET(): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return netlifyPopupPage(false, "You must be signed in to connect Netlify.")

  const clientId = process.env.NETLIFY_OAUTH_CLIENT_ID
  if (!clientId || !process.env.NETLIFY_OAUTH_CLIENT_SECRET) {
    return netlifyPopupPage(false, "Netlify isn't set up on this server.")
  }

  const state = randomUUID()
  const url = new URL("https://app.netlify.com/authorize")
  url.searchParams.set("client_id", clientId)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("redirect_uri", netlifyRedirectUri())
  url.searchParams.set("state", state)

  const res = NextResponse.redirect(url)
  res.cookies.set(NETLIFY_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/netlify",
    maxAge: 10 * 60,
  })
  return res
}

export async function DELETE(): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth

  try {
    await writeNetlifyToken(auth.userId, null)
    return Response.json({ ok: true })
  } catch (error) {
    return internalError(error)
  }
}
