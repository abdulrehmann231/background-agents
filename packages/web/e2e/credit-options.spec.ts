import { test, expect, type Page, type BrowserContext } from "@playwright/test"
import { setupTestAuth } from "./helpers"
import { DEFAULT_SETTINGS } from "../lib/storage"

async function setupCreditChat(page: Page, context: BrowserContext, initialBalance: number) {
  await setupTestAuth(page, context)
  let balance = initialBalance
  await page.route("**/api/user/settings", async (route) => {
    await route.fulfill({ json: {
      settings: { ...DEFAULT_SETTINGS, defaultAgent: "claude-code", defaultModel: "sonnet" },
      credentialFlags: { CLAUDE_SHARED_POOL_AVAILABLE: true, SHARED_BALANCE_EXHAUSTED: balance <= 0 },
      customEndpoints: [], creditBalanceUsd: balance, availableCreditsUsd: balance,
      creditsMode: "balance", providerMultipliers: { claude: 1 },
    } })
  })
  await page.route("**/api/user/star-reward", (route) => route.fulfill({ json: { rewarded: false, starred: false } }))
  const response = await page.request.post("/api/chats", { data: {
    repo: "__new__", baseBranch: "main", agent: "claude-code", model: "sonnet", status: "pending",
  } })
  expect(response.ok()).toBeTruthy()
  const { id } = await response.json()
  await page.clock.install()
  await page.goto(`/chat/${id}`)
  await expect(page.getByTestId("chat-input")).toBeVisible()
  return {
    async setBalance(next: number) {
      balance = next
      // Settings refresh when a stale tab becomes visible; use the same query
      // that turn completion invalidates, without running a paid model.
      await page.clock.fastForward(61_000)
      await page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")))
    },
  }
}

function creditDialog(page: Page) {
  return page.getByRole("dialog").filter({ has: page.getByText("Out of Credits", { exact: true }) })
}

test("depletion opens credit options once, and recovery rearms the prompt", async ({ page, context }) => {
  const chat = await setupCreditChat(page, context, 0.05)
  await expect(creditDialog(page)).not.toBeVisible()
  await chat.setBalance(0)
  await expect(creditDialog(page)).toBeVisible()
  await creditDialog(page).getByRole("button", { name: "Cancel", exact: true }).click()
  await chat.setBalance(-0.01)
  await expect(creditDialog(page)).not.toBeVisible()
  await chat.setBalance(1)
  await expect(page.getByTestId("credit-warning-banner")).not.toBeVisible()
  await chat.setBalance(0)
  await expect(creditDialog(page)).toBeVisible()
})

test("both warning banners open purchases and star rewards", async ({ page, context }) => {
  const chat = await setupCreditChat(page, context, 0.05)
  const banner = page.getByTestId("credit-warning-banner")
  await banner.getByRole("button", { name: "Add credits", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByText("Add Credits", { exact: true })).toBeVisible()
  await expect(dialog.getByRole("button", { name: /Star our repo/ })).toBeVisible()
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click()
  await chat.setBalance(0)
  await creditDialog(page).getByRole("button", { name: "Cancel", exact: true }).click()
  await banner.getByRole("button", { name: "Add credits", exact: true }).click()
  await expect(creditDialog(page)).toBeVisible()
})

test("blocked button and keyboard sends open credit options and keep the prompt", async ({ page, context }) => {
  await setupCreditChat(page, context, 0)
  await creditDialog(page).getByRole("button", { name: "Cancel", exact: true }).click()
  const input = page.getByTestId("chat-input")
  await input.fill("Keep this prompt")
  await page.getByRole("button", { name: "Send message", exact: true }).click()
  await expect(creditDialog(page)).toBeVisible()
  await creditDialog(page).getByRole("button", { name: "Cancel", exact: true }).click()
  await expect(input).toHaveValue("Keep this prompt")
  await input.press("Enter")
  await expect(creditDialog(page)).toBeVisible()
  await expect(input).toHaveValue("Keep this prompt")
})

test("an exhausted paid model opens credit options before changing selection", async ({ page, context }) => {
  await setupCreditChat(page, context, 0)
  await creditDialog(page).getByRole("button", { name: "Cancel", exact: true }).click()
  await page.getByRole("button", { name: /^(Sonnet|Auto)$/ }).click()
  await page.getByRole("option", { name: /Haiku/ }).click()
  await expect(creditDialog(page)).toBeVisible()
  await creditDialog(page).getByRole("button", { name: "Continue with OpenCode" }).click()
  await expect(creditDialog(page)).not.toBeVisible()
  await expect(page.getByTestId("credit-warning-banner")).not.toBeVisible()
})
