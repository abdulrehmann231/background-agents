import { test, expect } from "@playwright/test"
import { setupTestAuth } from "./helpers"

test("signed-out repository picker explains that GitHub sign-in is required", async ({
  page,
}) => {
  const repoRequests: string[] = []
  page.on("request", (request) => {
    if (request.url().includes("/api/github/repos")) {
      repoRequests.push(request.url())
    }
  })

  await page.goto("/")

  await page.getByRole("button", { name: "Repository" }).click()

  const picker = page.getByRole("dialog")
  await expect(
    picker.getByText("Sign in with GitHub to load your repositories.")
  ).toBeVisible()
  await expect(
    picker.getByRole("button", { name: "Sign in with GitHub" })
  ).toBeVisible()
  expect(repoRequests).toEqual([])
})

test("repository picker surfaces fetch errors and supports an explicit retry", async ({
  page,
  context,
}) => {
  await setupTestAuth(page, context)

  let serviceRecovered = false
  await page.route("**/api/github/repos?*", async (route) => {
    if (serviceRecovered) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ repos: [], page: 1, hasMore: false }),
      })
      return
    }

    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "GitHub is temporarily unavailable" }),
    })
  })

  await page.goto("/")
  await page.getByRole("button", { name: "Repository" }).click()

  const picker = page.getByRole("dialog")
  await expect(
    picker.getByText("GitHub is temporarily unavailable")
  ).toBeVisible()

  serviceRecovered = true
  await picker.getByRole("button", { name: "Retry" }).click()

  await expect(picker.getByText("No repositories found")).toBeVisible()
})
