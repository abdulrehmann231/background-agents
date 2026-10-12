import { execFile } from "node:child_process"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import type { Sandbox } from "@daytonaio/sdk"
import { describe, expect, it } from "vitest"
import { createSandboxJobs } from "../src/jobs"
import type { JobHandle } from "../src/types"

const run = promisify(execFile)

describe("command completion and descendant ownership", () => {
  // Exercise the generated status shell, substituting only process observations
  // and privileged cleanup. Real cgroups/HTTP services are covered separately.
  it.each([
    { name: "successful command leaves a service", exit: "0", completion: "0", expected: "exited" },
    { name: "failed command leaves a service", exit: "7", completion: "7", expected: "exited" },
    { name: "timeout leaves a service", exit: "124", completion: "124", expected: "exited" },
    { name: "legacy exit does not authorize completion", exit: "0", expected: "running" },
    { name: "mismatched records", exit: "0", completion: "7", expected: "running" },
    { name: "empty record", exit: "0", completion: "", expected: "running" },
    { name: "missing exit", completion: "0", expected: "running" },
    { name: "wrapper still running", exit: "0", completion: "0", leader: true, expected: "running" },
    { name: "cancellation still owns descendants", exit: "0", completion: "0", flag: "cancelling", expected: "running" },
    { name: "abort still owns descendants", exit: "0", completion: "0", flag: "aborted", expected: "running" },
    { name: "confirmed cancellation", exit: "143", completion: "0", flag: "cancelling", empty: true, expected: "exited" },
    { name: "crashed with no remaining work", empty: true, expected: "crashed" },
  ])("$name", async ({ exit, completion, leader, flag, empty, expected }) => {
    const dir = await mkdtemp(join(tmpdir(), "job-status-contract-"))
    try {
      const cgroup = join(dir, "cgroup")
      await mkdir(cgroup)
      await writeFile(join(cgroup, "cgroup.events"), `populated ${empty ? 0 : 1}\n`)
      if (exit !== undefined) await writeFile(join(dir, "exit"), exit)
      if (completion !== undefined) await writeFile(join(dir, "command-exit"), completion)
      if (flag) await writeFile(join(dir, flag), flag)
      const ps = leader ? "12345 12345 S\n12346 12345 S" : empty ? "" : "12346 12346 S"
      const handle: JobHandle = { jobId: "status-test", dir, pgid: 12345, cgroup,
        exitFile: join(dir, "exit"), outputFile: join(dir, "output.log") }
      await writeFile(handle.outputFile, "command output\n")
      const jobs = createSandboxJobs({ process: { executeCommand: async (command: string) => {
        try {
          const result = await run("sh", ["-c", `ps() { printf '%s\\n' '${ps}'; }; sudo() { return 1; }; ` + command])
          return { exitCode: 0, result: result.stdout }
        } catch (error) {
          return { exitCode: 1, result: (error as { stdout: string }).stdout }
        }
      } } } as unknown as Sandbox)
      const status = await jobs.status(handle)
      expect(status).toEqual({ state: expected, alive: expected === "running", exitCode: expected === "exited" ? Number(exit) : null })
      const read = await jobs.read(handle)
      expect(read.status).toEqual(status)
      expect(read.raw).toBe("command output\n")
      // Status observation never reaps services or removes their owned cgroup.
      expect(await readFile(join(cgroup, "cgroup.events"), "utf8"))
        .toBe(`populated ${empty ? 0 : 1}\n`)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
