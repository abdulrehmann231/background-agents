/**
 * Mass-assignment regression test for PATCH /api/chats/[chatId].
 *
 * The /api/agent/stream IDOR fix (see idor.spec.ts) hardened stream access to
 * trust the *chat row*: it derives sandboxId/backgroundSessionId from the
 * auth-checked chat rather than the URL. That made the chat row a trusted
 * pointer — so it must not be freely rewritable by the client.
 *
 * Before this fix, PATCH copied client-supplied `sandboxId`, `sessionId`,
 * `previewUrlPattern` and `backgroundSessionId` straight into the chat row
 * after only verifying ownership of the chat. A user could therefore point
 * their own chat at another user's sandbox/session and then read the victim's
 * agent stream — re-opening the IDOR through mass assignment.
 *
 * After the fix these four fields are server-managed and rejected by PATCH.
 * This test PATCHes them with blatantly foreign values and asserts the chat
 * row is unchanged.
 */

import { test, expect } from "@playwright/test"

test("PATCH /api/chats ignores client-supplied server-managed pointers", async ({ request }) => {
  // Pure HTTP test (no page render) — authenticate by fetching a test session
  // token and sending it as the next-auth cookie on each request.
  const authResp = await request.post("/api/test/auth")
  expect(authResp.ok()).toBeTruthy()
  const { token } = await authResp.json()
  const headers = { Cookie: `next-auth.session-token=${token}` }

  // Fresh chat: sandboxId/sessionId/backgroundSessionId are all null.
  const createResp = await request.post("/api/chats", {
    headers,
    data: {
      repo: "__new__",
      baseBranch: "main",
      agent: "eliza",
      model: "eliza-classic-1.0",
      status: "pending",
    },
  })
  expect(createResp.ok()).toBeTruthy()
  const { id: chatId } = await createResp.json()

  const FAKE_SANDBOX = "FAKE-FOREIGN-SANDBOX-FROM-MASS-ASSIGN-TEST"
  const FAKE_SESSION = "FAKE-FOREIGN-SESSION"
  const FAKE_BG = "FAKE-FOREIGN-BG-SESSION"

  // Attempt to rewrite the trusted pointers. `displayName` is a legitimately
  // client-writable field — include it so the request still performs a real
  // update and we prove the write path ran but dropped the sensitive fields.
  const patchResp = await request.patch(`/api/chats/${chatId}`, {
    headers,
    data: {
      displayName: "renamed-ok",
      sandboxId: FAKE_SANDBOX,
      sessionId: FAKE_SESSION,
      previewUrlPattern: "https://evil.example/{{PORT}}",
      backgroundSessionId: FAKE_BG,
    },
  })
  expect(patchResp.ok()).toBeTruthy()

  const patched = await patchResp.json()
  // The legitimate field was applied…
  expect(patched.displayName).toBe("renamed-ok")
  // …but the server-managed pointers were NOT accepted from the client.
  expect(patched.sandboxId).toBeNull()
  expect(patched.sessionId).toBeNull()
  expect(patched.backgroundSessionId).toBeNull()
  expect(patched.previewUrlPattern).not.toBe("https://evil.example/{{PORT}}")

  // Re-read to confirm the rejection was persisted, not just absent from the
  // response projection.
  const getResp = await request.get(`/api/chats/${chatId}`, { headers })
  expect(getResp.ok()).toBeTruthy()
  const fetched = await getResp.json()
  expect(fetched.sandboxId).toBeNull()
  expect(fetched.sessionId).toBeNull()
  expect(fetched.backgroundSessionId).toBeNull()
})
