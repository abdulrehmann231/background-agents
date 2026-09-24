/**
 * Command Code tool name mappings
 *
 * Command Code ships its own snake_case tool names (see the CLI's bundled
 * tools reference: read_file, write_file, edit_file, glob, grep,
 * shell_command, …). Map the ones with a canonical equivalent; everything else
 * (read_directory, todo_write, activate_skill, web_fetch, MCP tools, …) falls
 * through to the lowercased passthrough name.
 */

export const COMMAND_CODE_TOOL_MAPPINGS: Record<string, string> = {
  read_file: "read",
  write_file: "write",
  edit_file: "edit",
  glob: "glob",
  grep: "grep",
  shell_command: "shell",
  // Windows-only sibling of shell_command; harmless to map for completeness.
  powershell: "shell",
  web_search: "web_search",
}
