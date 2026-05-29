/**
 * Multi-window SSE streaming tests.
 *
 * Exercises behavior that only matters when more than one window/tab is open
 * in the same browser. Both pages live in the same Playwright BrowserContext
 * so that any cross-tab coordination (BroadcastChannel, localStorage, etc.)
 * can connect them — the same way two real browser windows would.
 *
 * All tests use the local Eliza agent (no API keys required).
 */

import { test, expect, type Request } from "@playwright/test"
import { setupTestAuth, setDefaultAgentEliza } from "./helpers"

test.describe.serial("Multi-window streaming", () => {
  /**
   * Leader election: two windows on the same browser should NOT each open
   * their own SSE connection to a running chat. Exactly one window opens the
   * `/api/agent/stream` EventSource (the "leader"); the other receives updates
   * via BroadcastChannel (or similar coordination in the stream store).
   *
   * TDD red: this test is **expected to fail today** because client-side
   * leader election is not implemented yet. `test.fail` lets the test run
   * for real (vs. `test.fixme` which would skip it) and asserts the failure
   * — so CI stays green while the feature is pending.
   *
   * When leader election lands in `packages/web/lib/stores/stream-store.ts`,
   * this test will start passing → `test.fail` will flag it as
   * "unexpectedly passed", and that's the signal to remove the `.fail`
   * modifier and turn this into a regular regression test.
   *
   * Current failure mode (red): pageA + pageB each open their own
   * EventSource → streamConnections === 2, so `expect(...).toBe(1)` fails.
   *
   * Side effects this test guards against once green: N× sandbox/DB load
   * with multiple windows, and the spurious "Push failed — force push?"
   * message produced by N concurrent auto-pushes from the per-connection
   * completion block in `app/api/agent/stream/route.ts`.
   */
  test.fail(
    "opens only one EventSource across two same-browser windows",
    async ({ browser }) => {
      const context = await browser.newContext()

      // Authenticate once on the context, then pin Eliza as the default
      // agent so the test doesn't depend on any API keys.
      const setupPage = await context.newPage()
      await setupTestAuth(setupPage, context)
      await setDefaultAgentEliza(setupPage)
      await setupPage.close()

      // Two pages in the SAME context — BroadcastChannel is per-context, so
      // this mirrors a user with two real windows open in one browser.
      const [pageA, pageB] = await Promise.all([
        context.newPage(),
        context.newPage(),
      ])

      // Count GET requests to /api/agent/stream across BOTH pages. The
      // leader-election invariant is that this stays at exactly 1 — only
      // the leader opens an EventSource; followers receive updates via the
      // BroadcastChannel rebroadcast.
      let streamConnections = 0
      const countStream = (req: Request) => {
        if (req.method() === "GET" && req.url().includes("/api/agent/stream")) {
          streamConnections++
        }
      }
      pageA.on("request", countStream)
      pageB.on("request", countStream)

      // Page A: load the app, send a message.
      await pageA.goto("/")
      await expect(pageA.getByTestId("chat-input")).toBeVisible({ timeout: 15000 })
      await expect(pageA.getByText("test@playwright.local")).toBeVisible({
        timeout: 10000,
      })

      const inputA = pageA.getByTestId("chat-input")
      await inputA.click()
      await inputA.fill("Hello?")
      await inputA.press("Enter")

      // Wait until pageA is actively streaming (sandbox created + agent
      // running). Only at this point is the chat's DB row status === "running",
      // which is the prerequisite for pageB's resume-streaming effect to
      // fire on its initial chats query.
      await expect(pageA.getByTestId("chat-container")).toHaveAttribute(
        "data-chat-status",
        "running",
        { timeout: 90000 }
      )

      // Page B: now load. Its initial chats query sees a running chat and
      // (in current, pre-leader-election code) the resume effect in
      // `useChatWithSync` opens its own EventSource.
      await pageB.goto("/")
      await expect(pageB.getByTestId("chat-input")).toBeVisible({ timeout: 15000 })

      // Wait for pageA to finish so we've captured every attempt either
      // page would have made (including any post-reconnect retries).
      await expect(pageA.getByTestId("chat-container")).toHaveAttribute(
        "data-chat-status",
        /^(ready|error)$/,
        { timeout: 120000 }
      )

      // Settle window for any late retry on pageB.
      await pageB.waitForTimeout(2000)

      // Invariant: exactly one EventSource opened across the whole browser.
      // Today this fails (count === 2). After leader election lands, it
      // should pass (count === 1) — at which point remove `test.fail` above.
      expect(streamConnections).toBe(1)

      await context.close()
    }
  )
})
