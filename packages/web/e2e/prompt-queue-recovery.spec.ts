import { test, expect } from "@playwright/test"
import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { setupTestAuth } from "./helpers"

// Controlled transport/reconnect tests. No model or sandbox is started: the
// synthetic chat has a dispatch reservation while its real DB/API is exercised.
test("a rejected prompt goes back to the composer and does not block the next prompt", async ({ page, context }) => {
  await setupTestAuth(page, context)
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) })
  let chatId: string | undefined
  try {
    const created = await page.request.post("/api/chats", { data: { repo: "__new__", status: "ready", agent: "eliza", model: "eliza-classic-1.0" } })
    expect(created.ok()).toBe(true)
    chatId = (await created.json()).id
    await db.chat.update({ where: { id: chatId! }, data: { queueDispatchId: `test-${chatId}` } })
    await db.message.create({ data: { chatId: chatId!, role: "user", content: "Initial history", timestamp: BigInt(Date.now()) } })
    let rejectedRequests = 0
    await page.route(`**/api/chats/${chatId}/queue`, (route) => {
      const body = route.request().method() === "POST" ? route.request().postDataJSON() : null
      if (body?.content === "Rejected prompt") {
        rejectedRequests++
        return route.fulfill({ status: 400, contentType: "application/json", body: '{"error":"Invalid queued prompt"}' })
      }
      return route.continue()
    })
    await page.goto(`/chat/${chatId}`)
    const input = page.getByTestId("chat-input")
    await input.fill("Rejected prompt")
    await input.press("Enter")
    await expect(input).toHaveValue("Rejected prompt")
    await expect(page.getByText("Could not queue your prompt")).toBeVisible()
    await expect(page.getByTestId("starting-indicator")).toHaveCount(0)
    await input.fill("Valid next prompt")
    await input.press("Enter")
    await expect.poll(async () => db.queuedPrompt.count({ where: { chatId, content: "Valid next prompt" } })).toBe(1)
    expect(await db.queuedPrompt.count({ where: { chatId, content: "Rejected prompt" } })).toBe(0)
    expect(rejectedRequests).toBe(1)
  } finally {
    if (chatId) await db.chat.deleteMany({ where: { id: chatId } })
    await db.$disconnect()
  }
})

test("a prompt sent while offline goes back to the composer and can be resent once online", async ({ page, context }) => {
  await setupTestAuth(page, context)
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) })
  let chatId: string | undefined
  try {
    const created = await page.request.post("/api/chats", { data: { repo: "__new__", status: "ready", agent: "eliza", model: "eliza-classic-1.0" } })
    chatId = (await created.json()).id
    await db.chat.update({ where: { id: chatId! }, data: { queueDispatchId: `test-${chatId}` } })
    await db.message.create({ data: { chatId: chatId!, role: "user", content: "Initial history", timestamp: BigInt(Date.now()) } })
    await page.goto(`/chat/${chatId}`)
    await expect(page.getByText("Initial history", { exact: true })).toBeVisible()
    const input = page.getByTestId("chat-input")
    await context.setOffline(true)
    await input.fill("Offline prompt 5172")
    await input.press("Enter")
    await expect(input).toHaveValue("Offline prompt 5172")
    await expect(page.getByText("Check the queue before sending it again.")).toBeVisible()
    await context.setOffline(false)
    await input.press("Enter")
    await expect.poll(async () => db.queuedPrompt.count({ where: { chatId, content: "Offline prompt 5172" } })).toBe(1)
    await expect(input).toHaveValue("")
  } finally {
    if (chatId) await db.chat.deleteMany({ where: { id: chatId } })
    await db.$disconnect()
  }
})

test("a ready observer reloads missed history after reconnect without a status transition", async ({ page, context }) => {
  await setupTestAuth(page, context)
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) })
  let chatId: string | undefined
  try {
    const created = await page.request.post("/api/chats", { data: { repo: "__new__", status: "ready", agent: "eliza", model: "eliza-classic-1.0" } })
    chatId = (await created.json()).id
    await db.message.create({ data: { chatId: chatId!, role: "user", content: "Old history", timestamp: BigInt(Date.now() - 1000) } })
    await page.goto(`/chat/${chatId}`)
    await expect(page.getByText("Old history", { exact: true })).toBeVisible()
    await context.setOffline(true)
    await db.message.createMany({ data: [
      { chatId: chatId!, role: "user", content: "Missed prompt 8421", timestamp: BigInt(Date.now()) },
      { chatId: chatId!, role: "assistant", content: "Reply 8421", timestamp: BigInt(Date.now() + 1) },
    ] })
    await db.chat.update({ where: { id: chatId! }, data: { status: "ready" } })
    await context.setOffline(false)
    await expect(page.getByText("Missed prompt 8421", { exact: true })).toBeVisible()
    await expect(page.getByText("Reply 8421", { exact: true })).toBeVisible()
    await expect(page.getByTestId("chat-container")).toHaveAttribute("data-chat-status", "ready")
  } finally {
    await context.setOffline(false)
    if (chatId) await db.chat.deleteMany({ where: { id: chatId } })
    await db.$disconnect()
  }
})
