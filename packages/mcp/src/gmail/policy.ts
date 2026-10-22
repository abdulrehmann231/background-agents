/**
 * Per-connection policy for the Gmail MCP server.
 *
 * The policy is the security boundary: the agent only ever holds a token for
 * our MCP server, never a Google credential, so anything the server refuses
 * here the agent cannot do at all.
 *
 * Client-safe (zod only): the web UI imports it via
 * `@background-agents/mcp/gmail/policy`.
 */

import { z } from "zod"

export { GMAIL_MCP_QUALIFIED_NAME } from "./constants"

export const GMAIL_TOOL_NAMES = [
  "search_threads",
  "get_thread",
  "list_labels",
  "create_draft",
  "send_message",
  "modify_thread_labels",
] as const

export type GmailToolName = (typeof GMAIL_TOOL_NAMES)[number]

export const gmailToolPolicySchema = z.object({
  /** Tools the agent may see and call. Anything else isn't registered. */
  allowedTools: z.array(z.enum(GMAIL_TOOL_NAMES)),
  /**
   * When set, every To/Cc/Bcc address on drafts and sent mail must match an
   * entry: either a full address ("alice@x.com") or a domain ("@x.com").
   */
  allowedRecipients: z.array(z.string().min(1)).optional(),
  /**
   * When set, the agent can only search, read, reply to, and relabel threads
   * carrying this Gmail label (by name, e.g. "agent-inbox").
   */
  restrictToLabel: z.string().min(1).optional(),
  /** Upper bound on search page size. */
  maxResults: z.number().int().min(1).max(100).optional(),
})

export type GmailToolPolicy = z.infer<typeof gmailToolPolicySchema>

const READ_TOOLS: GmailToolName[] = ["search_threads", "get_thread", "list_labels"]

export const GMAIL_POLICY_PRESETS = {
  readOnly: { allowedTools: READ_TOOLS },
  readDraft: { allowedTools: [...READ_TOOLS, "create_draft"] },
  full: { allowedTools: [...GMAIL_TOOL_NAMES] },
} satisfies Record<string, GmailToolPolicy>

export const DEFAULT_GMAIL_POLICY: GmailToolPolicy = GMAIL_POLICY_PRESETS.readOnly

/**
 * Parse a stored policy. A missing or invalid value falls back to the
 * read-only default rather than failing open.
 */
export function parseGmailToolPolicy(value: unknown): GmailToolPolicy {
  if (value == null) return DEFAULT_GMAIL_POLICY
  const parsed = gmailToolPolicySchema.safeParse(value)
  if (parsed.success) return parsed.data
  console.warn(
    "[gmail-mcp] invalid stored tool policy, using read-only default:",
    parsed.error.message
  )
  return DEFAULT_GMAIL_POLICY
}

export function isRecipientAllowed(
  policy: GmailToolPolicy,
  address: string
): boolean {
  if (!policy.allowedRecipients) return true
  const addr = address.toLowerCase()
  return policy.allowedRecipients.some((entry) => {
    const rule = entry.toLowerCase()
    return rule.startsWith("@") ? addr.endsWith(rule) : addr === rule
  })
}
