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

import { test, expect, type Request, type Route } from "@playwright/test"
import { setupTestAuth, setDefaultAgentEliza } from "./helpers"

test.describe.serial("Multi-window streaming", () => {
  /**
   * Leader election: two windows on the same browser, both viewing the same
   * running chat, should NOT each open their own SSE connection. Exactly one
   * window opens the `/api/agent/stream` EventSource (the "leader"); the
   * other receives updates via BroadcastChannel (or similar coordination in
   * the stream store).
   *
   * TDD red: this test is **expected to fail today** because client-side
   * leader election is not implemented yet. `test.fail` lets the test run
   * for real (vs. `test.fixme` which would skip it) and asserts the failure
   * — so CI stays green while the feature is pending.
   *
   * When leader election lands in `packages/web/lib/stores/stream-store.ts`,
   * the test will start passing → `test.fail` will flag it as
   * "unexpectedly passed", and that's the signal to remove the `.fail`
   * modifier and turn this into a regular regression test.
   *
   * Current failure mode (red): pageA + pageB each open their own
   * EventSource → streamConnections === 2, so `expect(...).toBe(1)` fails.
   *
   * --- Design notes (why the test looks the way it does) ---
   *
   * 1. Eliminating the agent-timing race. The naïve version (let pageA's
   *    SSE complete normally, then check pageB) races against Eliza's
   *    response time. We intercept `/api/agent/stream` on BOTH pages with
   *    a route handler that never responds — the browser emits the
   *    `request` event the moment the EventSource opens (so the count is
   *    accurate) but the request sits open forever, so pageA's chat-status
   *    stays "running" indefinitely and there is no time pressure on pageB.
   *
   * 2. Reproducing the real-world bug. The chats-list endpoint
   *    (`GET /api/chats`) does NOT include message arrays — those are
   *    fetched only for the currently selected chat
   *    (see `useChatWithSync` loadMessages effect). The resume-streaming
   *    effect requires `lastAssistantMsg` from `chat.messages`; without it,
   *    pageB silently does nothing. So merely opening pageB on `/` does NOT
   *    duplicate the SSE — the bug manifests when both windows have the
   *    same chat *selected*. The test mirrors that by clicking the chat in
   *    pageB's sidebar.
   *
   * 3. Using waitForRequest for the baseline. Asserting `streamConnections
   *    === 1` right after `data-chat-status` flips to "running" is racy:
   *    React renders the attribute on the same tick as `startStreaming()`
   *    is called, but the `request` event from the browser CDP can land a
   *    few ms later. We pre-arm `waitForRequest` before sending, then
   *    await it after — guaranteed to fire iff pageA actually opened the
   *    EventSource.
   */
  test.fail(
    "opens only one EventSource across two same-browser windows viewing the same chat",
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

      // Hang every SSE request on both pages so the test is independent of
      // agent response time (see design note 1).
      const hangSse = async (_route: Route) => {
        await new Promise(() => {
          /* never resolves */
        })
      }
      await pageA.route("**/api/agent/stream**", hangSse)
      await pageB.route("**/api/agent/stream**", hangSse)

      // Count GET requests to /api/agent/stream across BOTH pages. The
      // leader-election invariant is that this stays at exactly 1.
      let streamConnections = 0
      const countStream = (req: Request) => {
        if (req.method() === "GET" && req.url().includes("/api/agent/stream")) {
          streamConnections++
        }
      }
      pageA.on("request", countStream)
      pageB.on("request", countStream)

      // Page A: load.
      await pageA.goto("/")
      await expect(pageA.getByTestId("chat-input")).toBeVisible({ timeout: 15000 })
      await expect(pageA.getByText("test@playwright.local")).toBeVisible({
        timeout: 10000,
      })

      // Pre-arm: capture pageA's SSE request without racing the React
      // rerender → request-event order (see design note 3). The timeout
      // covers sandbox creation (30–60s) plus a buffer.
      const pageASseFired = pageA.waitForRequest(
        (req) =>
          req.method() === "GET" && req.url().includes("/api/agent/stream"),
        { timeout: 120000 }
      )

      const inputA = pageA.getByTestId("chat-input")
      await inputA.click()
      await inputA.fill("Hello?")
      await inputA.press("Enter")

      // Wait until pageA has actually opened its SSE (which is what the
      // `useChatWithSync.sendMessage` flow does once the messages-POST
      // returns with sandboxId + backgroundSessionId).
      await pageASseFired
      expect(streamConnections, "pageA should have opened exactly one SSE").toBe(
        1
      )

      // Sanity: pageA's chat-status should also be "running" by now (client
      // optimistic update — happens in the same tick as startStreaming).
      await expect(pageA.getByTestId("chat-container")).toHaveAttribute(
        "data-chat-status",
        "running",
        { timeout: 5000 }
      )

      // Page B: load.
      await pageB.goto("/")
      await expect(pageB.getByTestId("chat-input")).toBeVisible({ timeout: 15000 })

      // Click the chat in pageB's sidebar so it becomes pageB's selected
      // chat. This triggers `loadMessages` (currentChatId effect in
      // useChatWithSync) and, after messages arrive, the resume-streaming
      // effect — which in current (pre-leader-election) code opens a 2nd
      // EventSource (caught by `hangSse` on pageB).
      const chatItemB = pageB.locator('[data-testid="chat-item"]').first()
      await expect(chatItemB).toBeVisible({ timeout: 30000 })
      await chatItemB.click()

      // Give pageB ample time to (a) call /api/chats/{id}, (b) hydrate
      // messages into the cache, (c) re-run the resume effect, and
      // (d) actually open the EventSource (if it's going to).
      await pageB.waitForTimeout(10000)

      // Invariant: pageB did NOT open its own EventSource. Today this
      // fails (pageB's resume effect opens a 2nd SSE → count goes to 2);
      // after leader election lands, count stays at 1.
      expect(
        streamConnections,
        "leader election: pageB must not open a second SSE while pageA is the leader"
      ).toBe(1)

      await context.close()
    }
  )
})
