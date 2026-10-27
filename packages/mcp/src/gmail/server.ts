/**
 * Gmail MCP server, built per request from a connection's policy.
 *
 * Tools outside `policy.allowedTools` are never registered, so they're absent
 * from tools/list and calling them fails. Argument rules (recipient allowlist,
 * label scope, result cap) are checked inside each handler; a thrown error
 * goes back to the agent as a tool error.
 *
 * Runs stateless: every HTTP request gets a fresh server + transport, so a
 * policy change applies to the very next tool call.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { z } from "zod"
import { GMAIL_API_BASE } from "./constants"
import { type GmailToolName, type GmailToolPolicy, isRecipientAllowed } from "./policy"

export interface ServeGmailMcpOptions {
  policy: GmailToolPolicy
  /** Called lazily, only when a tool actually hits the Gmail API. */
  getAccessToken: () => Promise<string>
}

interface GmailMessagePart {
  mimeType?: string
  headers?: { name: string; value: string }[]
  body?: { data?: string }
  parts?: GmailMessagePart[]
}

interface GmailMessage {
  id: string
  labelIds?: string[]
  snippet?: string
  payload?: GmailMessagePart
}

interface GmailThread {
  id: string
  messages?: GmailMessage[]
}

const DEFAULT_MAX_RESULTS = 20
/** Keep one long email from flooding the agent's context. */
const MAX_BODY_CHARS = 20_000

const messageShape = {
  to: z.array(z.string().email()).min(1),
  cc: z.array(z.string().email()).optional(),
  bcc: z.array(z.string().email()).optional(),
  subject: z.string(),
  body: z.string().describe("Plain-text body"),
  threadId: z.string().optional().describe("Reply within this thread"),
}

type OutgoingMessage = z.infer<z.ZodObject<typeof messageShape>>

export async function serveGmailMcp(
  req: Request,
  options: ServeGmailMcpOptions
): Promise<Response> {
  const server = createGmailMcpServer(options)
  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true,
  })
  await server.connect(transport)
  return transport.handleRequest(req)
}

function createGmailMcpServer({ policy, getAccessToken }: ServeGmailMcpOptions): McpServer {
  const server = new McpServer({ name: "gmail", version: "0.1.0" })

  async function gmail<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${GMAIL_API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${await getAccessToken()}`,
        "Content-Type": "application/json",
      },
    })
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      throw new Error(`Gmail API ${res.status}: ${body}`)
    }
    // Some endpoints (e.g. drafts.delete) return 204 with no body.
    if (res.status === 204) return undefined as T
    const text = await res.text()
    return (text ? JSON.parse(text) : undefined) as T
  }

  let scopeLabelId: Promise<string> | undefined
  function getScopeLabelId(): Promise<string> {
    scopeLabelId ??= gmail<{ labels: { id: string; name: string }[] }>("/labels").then(
      ({ labels }) => {
        const label = labels.find((l) => l.name === policy.restrictToLabel)
        if (!label) throw new Error(`Label "${policy.restrictToLabel}" not found`)
        return label.id
      }
    )
    return scopeLabelId
  }

  /** Fetch a thread, refusing it when it's outside the policy's label scope. */
  async function getScopedThread(
    threadId: string,
    format: "full" | "minimal"
  ): Promise<GmailThread> {
    const thread = await gmail<GmailThread>(
      `/threads/${encodeURIComponent(threadId)}?format=${format}`
    )
    if (policy.restrictToLabel) {
      const labelId = await getScopeLabelId()
      if (!thread.messages?.some((m) => m.labelIds?.includes(labelId))) {
        throw new Error("Thread is outside this connection's label scope")
      }
    }
    return thread
  }

  /**
   * The recipient allowlist only gates actually sending mail. Drafts stay
   * local to the mailbox until a human sends them, so they're exempt.
   */
  async function prepareOutgoing(
    message: OutgoingMessage,
    { enforceRecipientAllowlist }: { enforceRecipientAllowlist: boolean }
  ) {
    if (enforceRecipientAllowlist) {
      const recipients = [...message.to, ...(message.cc ?? []), ...(message.bcc ?? [])]
      const denied = recipients.filter((r) => !isRecipientAllowed(policy, r))
      if (denied.length > 0) {
        throw new Error(`Recipients not allowed by policy: ${denied.join(", ")}`)
      }
    }
    if (message.threadId) await getScopedThread(message.threadId, "minimal")
    return { raw: buildRawMessage(message), threadId: message.threadId }
  }

  function register<Shape extends z.ZodRawShape>(
    name: GmailToolName,
    description: string,
    inputSchema: Shape,
    run: (args: z.infer<z.ZodObject<Shape>>) => Promise<unknown>
  ): void {
    if (!policy.allowedTools.includes(name)) return
    // Widened to the non-generic shape: the SDK's callback type is a
    // conditional that can't resolve through our `Shape` generic. The SDK
    // validates args against `inputSchema` before calling us.
    const schema: z.ZodRawShape = inputSchema
    server.registerTool(name, { description, inputSchema: schema }, async (args) => {
      try {
        const result = await run(args as z.infer<z.ZodObject<Shape>>)
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] }
      } catch (error) {
        console.warn(
          `[gmail-mcp] ${name} failed:`,
          error instanceof Error ? error.message : error
        )
        throw error
      }
    })
  }

  register(
    "search_threads",
    "Search Gmail threads using Gmail search syntax. Returns thread ids and snippets.",
    {
      query: z.string().describe("Gmail search query, e.g. 'from:alice is:unread'"),
      maxResults: z.number().int().min(1).max(100).optional(),
    },
    async ({ query, maxResults }) => {
      const limit = Math.min(
        maxResults ?? DEFAULT_MAX_RESULTS,
        policy.maxResults ?? Number.POSITIVE_INFINITY
      )
      const params = new URLSearchParams({ q: query, maxResults: String(limit) })
      if (policy.restrictToLabel) params.set("labelIds", await getScopeLabelId())
      const data = await gmail<{ threads?: { id: string; snippet: string }[] }>(
        `/threads?${params}`
      )
      return data.threads ?? []
    }
  )

  register(
    "get_thread",
    "Read every message in a thread: headers, labels, and plain-text body.",
    { threadId: z.string() },
    async ({ threadId }) => {
      const thread = await getScopedThread(threadId, "full")
      return { id: thread.id, messages: (thread.messages ?? []).map(summarizeMessage) }
    }
  )

  register("list_labels", "List the mailbox's labels.", {}, async () => {
    const data = await gmail<{ labels: { id: string; name: string; type: string }[] }>(
      "/labels"
    )
    return data.labels.map(({ id, name, type }) => ({ id, name, type }))
  })

  register(
    "create_draft",
    "Create a draft email. It is not sent.",
    messageShape,
    async (message) => {
      const draft = await gmail<{ id: string }>("/drafts", {
        method: "POST",
        body: JSON.stringify({
          message: await prepareOutgoing(message, { enforceRecipientAllowlist: false }),
        }),
      })
      return { draftId: draft.id }
    }
  )

  register(
    "delete_draft",
    "Permanently delete a draft (from its draft id, not a thread or message id).",
    { draftId: z.string() },
    async ({ draftId }) => {
      await gmail(`/drafts/${encodeURIComponent(draftId)}`, { method: "DELETE" })
      return { ok: true }
    }
  )

  register("send_message", "Send an email.", messageShape, async (message) => {
    const sent = await gmail<{ id: string; threadId: string }>("/messages/send", {
      method: "POST",
      body: JSON.stringify(
        await prepareOutgoing(message, { enforceRecipientAllowlist: true })
      ),
    })
    return { messageId: sent.id, threadId: sent.threadId }
  })

  register(
    "modify_thread_labels",
    "Add or remove labels on a thread (use label ids from list_labels).",
    {
      threadId: z.string(),
      addLabelIds: z.array(z.string()).optional(),
      removeLabelIds: z.array(z.string()).optional(),
    },
    async ({ threadId, addLabelIds, removeLabelIds }) => {
      await getScopedThread(threadId, "minimal")
      await gmail(`/threads/${encodeURIComponent(threadId)}/modify`, {
        method: "POST",
        body: JSON.stringify({ addLabelIds, removeLabelIds }),
      })
      return { ok: true }
    }
  )

  return server
}

function summarizeMessage(message: GmailMessage) {
  const header = (name: string) =>
    message.payload?.headers?.find((h) => h.name.toLowerCase() === name)?.value
  const text = message.payload ? extractPlainText(message.payload) : ""
  return {
    id: message.id,
    from: header("from"),
    to: header("to"),
    cc: header("cc"),
    subject: header("subject"),
    date: header("date"),
    labelIds: message.labelIds,
    body: (text || message.snippet || "").slice(0, MAX_BODY_CHARS),
  }
}

function extractPlainText(part: GmailMessagePart): string {
  if (part.mimeType === "text/plain" && part.body?.data) {
    return Buffer.from(part.body.data, "base64url").toString("utf8")
  }
  for (const child of part.parts ?? []) {
    const text = extractPlainText(child)
    if (text) return text
  }
  return ""
}

/**
 * Build a base64url RFC 2822 message. Addresses are validated as emails and
 * the subject is RFC 2047-encoded, so neither can inject extra headers.
 */
function buildRawMessage({ to, cc, bcc, subject, body }: OutgoingMessage): string {
  const headers = [
    `To: ${to.join(", ")}`,
    cc?.length ? `Cc: ${cc.join(", ")}` : null,
    bcc?.length ? `Bcc: ${bcc.join(", ")}` : null,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
  ].filter((h): h is string => h !== null)
  const mime = `${headers.join("\r\n")}\r\n\r\n${Buffer.from(body).toString("base64")}`
  return Buffer.from(mime).toString("base64url")
}
