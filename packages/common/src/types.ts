/**
 * Shared types for upstream-agents packages
 */

// =============================================================================
// Content Blocks (for displaying agent output)
// =============================================================================

export interface ToolCall {
  tool: string
  summary: string
  fullSummary?: string
  filePath?: string
  /** Multiple file paths, for tools (e.g. SendUserFile) that act on more than one file at once. */
  filePaths?: string[]
  output?: string
}

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_calls"; toolCalls: ToolCall[] }
