/**
 * Gmail MCP provider exports.
 */

export { GMAIL_MCP_QUALIFIED_NAME } from "./constants"
export {
  GMAIL_TOOL_NAMES,
  type GmailToolName,
  gmailToolPolicySchema,
  type GmailToolPolicy,
  GMAIL_POLICY_PRESETS,
  DEFAULT_GMAIL_POLICY,
  parseGmailToolPolicy,
} from "./policy"
export {
  createGmailMcpProvider,
  GmailMcpProvider,
  type GmailMcpConfig,
} from "./provider"
export { serveGmailMcp, type ServeGmailMcpOptions } from "./server"
