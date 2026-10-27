import { esc, type SandboxLike } from "@background-agents/sandbox-git"
import { UNCOMMITTED_STATUS_COMMAND, parseUncommittedPaths } from "./uncommitted-files"

export interface ChangedFile {
  path: string
  status: "added" | "deleted" | "modified" | "renamed"
  additions: number
  deletions: number
  binary: boolean
  /** Patch lines from the first hunk header on. */
  lines: string[]
  /** Still outside a commit, so a push wouldn't include it. */
  uncommitted: boolean
}

export interface ChangesResult {
  baseBranch: string
  files: ChangedFile[]
  /** The diff hit MAX_DIFF_BYTES, so the last files are cut off or missing. */
  truncated: boolean
}

// Keeps the response well under Vercel's 4.5 MB limit; a lockfile rewrite
// alone can be several MB.
const MAX_DIFF_BYTES = 1_000_000
// Separates the diff from the status output in one command's result.
const SEPARATOR = "\x1e"

/**
 * Everything this branch changed since it left `baseBranch`: commits plus
 * uncommitted edits and new files. Comparing with the merge base leaves out
 * commits that landed on the base branch later.
 */
export async function inspectChanges(
  sandbox: SandboxLike,
  repoPath: string,
  baseBranch: string
): Promise<ChangesResult> {
  const diff = "git -c core.quotePath=false diff --no-color --no-ext-diff"
  const command = [
    `cd ${esc(repoPath)} || exit 1`,
    `base=$(git merge-base ${esc(`origin/${baseBranch}`)} HEAD 2>/dev/null) || exit 2`,
    // New files aren't in `git diff`; diff each against /dev/null instead.
    `{ ${diff} "$base"; git ls-files --others --exclude-standard -z | xargs -0 -r -n1 ${diff} --no-index -- /dev/null; } | head -c ${MAX_DIFF_BYTES + 1}`,
    `printf '${SEPARATOR}'`,
    UNCOMMITTED_STATUS_COMMAND,
  ].join("\n")
  const { result, exitCode } = await sandbox.process.executeCommand(command)
  if (exitCode === 2) throw new Error(`Couldn't find where this branch started from ${baseBranch}.`)
  if (exitCode !== 0) throw new Error(`Couldn't read the changes: ${result.slice(0, 200)}`)

  const split = result.lastIndexOf(SEPARATOR)
  const patch = result.slice(0, split)
  const uncommitted = new Set(parseUncommittedPaths(result.slice(split + 1)))
  const files = parsePatch(patch.slice(0, MAX_DIFF_BYTES))
    .map((file) => ({ ...file, uncommitted: uncommitted.has(file.path) }))
    .sort((a, b) => a.path.localeCompare(b.path))
  return { baseBranch, files, truncated: patch.length > MAX_DIFF_BYTES }
}

/** Split `git diff` output into files. */
export function parsePatch(patch: string): Omit<ChangedFile, "uncommitted">[] {
  const files: Omit<ChangedFile, "uncommitted">[] = []
  for (const block of patch.split(/^(?=diff --git )/m)) {
    if (!block.startsWith("diff --git ")) continue
    const lines = block.replace(/\n$/, "").split("\n")
    const hunkStart = lines.findIndex((line) => line.startsWith("@@"))
    const header = hunkStart === -1 ? lines : lines.slice(0, hunkStart)
    const body = hunkStart === -1 ? [] : lines.slice(hunkStart)
    const renamedTo = header.find((line) => line.startsWith("rename to "))?.slice("rename to ".length)
    // Unless it was renamed, `diff --git a/<path> b/<path>` names the path twice.
    const both = lines[0].slice("diff --git a/".length)
    const path = renamedTo ?? both.slice(0, (both.length - 3) / 2)

    files.push({
      path,
      status: header.some((line) => line.startsWith("new file mode"))
        ? "added"
        : header.some((line) => line.startsWith("deleted file mode"))
          ? "deleted"
          : renamedTo
            ? "renamed"
            : "modified",
      additions: body.filter((line) => line.startsWith("+")).length,
      deletions: body.filter((line) => line.startsWith("-")).length,
      binary: header.some((line) => line.startsWith("Binary files ")),
      lines: body,
    })
  }
  return files
}
