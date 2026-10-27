import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { describe, expect, it } from "vitest"
import { inspectChanges } from "./changes"

const env = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.invalid",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.invalid",
}

/** A remote with a `main` branch, and a clone on an agent branch, like the sandbox. */
function sandboxFixture() {
  const root = mkdtempSync("/private/tmp/backgrounder-changes-test-")
  const run = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe", env })
  const write = (dir: string, path: string, content: string | Buffer) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), content)
  }

  const seed = join(root, "seed")
  run(root, "init", "--initial-branch=main", seed)
  write(seed, "src/toast.tsx", "line 1\nline 2\n")
  write(seed, "old.txt", "remove me\n")
  write(seed, "name.txt", "same content\n")
  run(seed, "add", ".")
  run(seed, "commit", "-m", "baseline")
  run(root, "clone", "--bare", seed, join(root, "remote.git"))

  const repo = join(root, "project")
  run(root, "clone", "--single-branch", "-b", "main", join(root, "remote.git"), repo)
  run(repo, "checkout", "-b", "agent/abc")

  const sandbox = {
    process: {
      executeCommand: async (command: string) => {
        const res = spawnSync("/bin/sh", ["-c", command], { cwd: repo, encoding: "utf8", env })
        return { result: res.stdout + res.stderr, exitCode: res.status ?? 1 }
      },
    },
  }
  return { root, seed, repo, sandbox, git: (...args: string[]) => run(repo, ...args), write: (path: string, content: string | Buffer) => write(repo, path, content) }
}

describe("inspectChanges", () => {
  it("lists committed and uncommitted changes since the branch left its base", async () => {
    const f = sandboxFixture()
    f.write("src/toast.tsx", "line 1\nline 2 changed\n")
    f.git("mv", "name.txt", "renamed.txt")
    f.git("commit", "-qam", "agent commit")
    f.git("rm", "-q", "old.txt")
    f.write("new file.ts", "export {}\n")
    f.write("logo.png", Buffer.from([0, 1, 2, 3]))

    // Someone else merges into main after the chat started.
    f.write("../seed/later.txt", "not the agent's\n")
    execFileSync("git", ["add", "."], { cwd: f.seed, env })
    execFileSync("git", ["commit", "-m", "later"], { cwd: f.seed, env })
    execFileSync("git", ["push", "-q", join(f.root, "remote.git"), "main"], { cwd: f.seed, env })
    f.git("fetch", "-q", "origin", "main")

    const { files, truncated } = await inspectChanges(f.sandbox, f.repo, "main")
    const summary = files.map(({ path, status, additions, deletions, binary, uncommitted }) =>
      ({ path, status, additions, deletions, binary, uncommitted }))
    expect(truncated).toBe(false)
    expect(summary).toEqual([
      { path: "logo.png", status: "added", additions: 0, deletions: 0, binary: true, uncommitted: true },
      { path: "new file.ts", status: "added", additions: 1, deletions: 0, binary: false, uncommitted: true },
      { path: "old.txt", status: "deleted", additions: 0, deletions: 1, binary: false, uncommitted: true },
      { path: "renamed.txt", status: "renamed", additions: 0, deletions: 0, binary: false, uncommitted: false },
      { path: "src/toast.tsx", status: "modified", additions: 1, deletions: 1, binary: false, uncommitted: false },
    ])
    expect(files.find((file) => file.path === "src/toast.tsx")?.lines).toEqual([
      "@@ -1,2 +1,2 @@",
      " line 1",
      "-line 2",
      "+line 2 changed",
    ])
  })

  it("explains when the base branch can't be found", async () => {
    const f = sandboxFixture()
    await expect(inspectChanges(f.sandbox, f.repo, "develop")).rejects.toThrow("develop")
  })
})
