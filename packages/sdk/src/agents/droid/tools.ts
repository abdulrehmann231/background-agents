/**
 * Droid (Factory) tool name mappings
 *
 * droid exec emits its OWN stream-json with droid-native tool names (captured
 * from real runs), which differ from Claude's. Map the ones that have a canonical
 * equivalent; anything unmapped (LS, TodoWrite, FetchUrl, …) falls through to a
 * lowercased passthrough name.
 */

export const DROID_TOOL_MAPPINGS: Record<string, string> = {
  Read: "read",
  Create: "write", // droid creates files with `Create`
  Edit: "edit",
  ApplyPatch: "edit",
  Grep: "grep",
  Glob: "glob",
  Execute: "shell", // droid runs shell commands with `Execute`
  WebSearch: "web_search",
}
