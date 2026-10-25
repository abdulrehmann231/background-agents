import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const { writeNetlifyToken } = vi.hoisted(() => ({ writeNetlifyToken: vi.fn() }))

vi.mock("@/lib/server/netlify", () => ({
  NETLIFY_STATE_COOKIE: "netlify_oauth_state",
  netlifyRedirectUri: () => "http://localhost:4000/api/netlify/callback",
  netlifyPopupPage: (ok: boolean, message: string) => new Response(message, { status: ok ? 200 : 400 }),
  writeNetlifyToken,
}))
vi.mock("@/lib/db/api-helpers", () => ({
  requireAuth: vi.fn().mockResolvedValue({ userId: "authenticated-user" }),
  isAuthError: (r: unknown) => r instanceof Response,
}))

import { GET } from "./route"

const fetchMock = vi.fn()

function callbackRequest(query: string, cookieState?: string): NextRequest {
  return new NextRequest(`http://localhost:4000/api/netlify/callback?${query}`, {
    headers: cookieState ? { cookie: `netlify_oauth_state=${cookieState}` } : {},
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal("fetch", fetchMock)
  process.env.NETLIFY_OAUTH_CLIENT_ID = "client-id"
  process.env.NETLIFY_OAUTH_CLIENT_SECRET = "client-secret"
})

describe("netlify callback", () => {
  it("exchanges the code and stores the token when the state matches", async () => {
    fetchMock.mockResolvedValue(Response.json({ access_token: "netlify-token" }))

    const res = await GET(callbackRequest("code=abc&state=s1", "s1"))

    expect(res.status).toBe(200)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://api.netlify.com/oauth/token")
    const body = new URLSearchParams(init.body as URLSearchParams)
    expect(body.get("grant_type")).toBe("authorization_code")
    expect(body.get("code")).toBe("abc")
    expect(body.get("redirect_uri")).toBe("http://localhost:4000/api/netlify/callback")
    expect(writeNetlifyToken).toHaveBeenCalledWith("authenticated-user", "netlify-token")
  })

  it("rejects a callback whose state doesn't match the cookie", async () => {
    const res = await GET(callbackRequest("code=abc&state=forged", "s1"))

    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(writeNetlifyToken).not.toHaveBeenCalled()
  })

  it("stores nothing when Netlify rejects the code", async () => {
    fetchMock.mockResolvedValue(new Response("bad code", { status: 401 }))

    const res = await GET(callbackRequest("code=abc&state=s1", "s1"))

    expect(res.status).toBe(400)
    expect(writeNetlifyToken).not.toHaveBeenCalled()
  })
})
