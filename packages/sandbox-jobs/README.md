# @background-agents/sandbox-jobs

Run, observe, and reconnect to **long-running shell processes** in a Daytona
sandbox — using the sandbox filesystem as the durable source of truth.

The problem it solves: a sandbox's `executeCommand` is request/response and
short-lived, but a real job (an agent run, a build, a test suite) can run for
minutes. This package detaches the process inside the sandbox and represents the
entire run as files, so a **cold caller** — a serverless function, a restarted
server, a different process — can reattach by id and read output incrementally
without ever holding a connection open.

## Model

One job = one process = one directory:

```
<root>/<jobId>/
  meta.json     { jobId, pgid, outputFile, exitFile, createdAt, version }
  output.log    combined stdout+stderr, byte-exact, append-only
  exit          integer $?, present ONLY once the process finishes
```

- **Detached + reapable.** Launched with `setsid` in its own process group, so
  `cancel()` reaps the command *and* its children.
- **Real exit codes.** The wrapper records the true `$?`; completion is never
  guessed. A process killed before it could write `$?` (SIGKILL/OOM) is detected
  as `crashed` via process-group liveness.
- **Incremental, UTF-8-safe reads.** `read(handle, cursor)` returns only bytes
  after the cursor, truncated to the last complete line — so the cursor never
  splits a multi-byte character and you never re-read the whole log.
- **Cold reconnect.** Everything needed to reattach is the serializable
  `JobHandle` + an integer cursor, or just the job id via `attach()`.

## Usage

```ts
import { createSandboxJobs } from "@background-agents/sandbox-jobs"

const jobs = createSandboxJobs(sandbox) // a @daytonaio/sdk Sandbox

const handle = await jobs.start({
  command: `for i in $(seq 1 100); do echo "tick $i"; sleep 1; done`,
  cwd: "/home/daytona/project",
  env: { FOO: "bar" },
  timeoutSeconds: 600, // optional hard limit (coreutils `timeout`)
})

// Poll incrementally (cold-start safe — rebuild `jobs`/`handle` each time):
let cursor = 0
for (;;) {
  const r = await jobs.read(handle, cursor)
  cursor = r.cursor
  process.stdout.write(r.raw)
  if (r.status.state !== "running") {
    console.log("done", r.status) // { state: "exited", exitCode: 0, alive: false }
    break
  }
}

// Or reattach later from just the id:
const reattached = await jobs.attach(handle.jobId)
```

## Tests

```bash
npm run typecheck
npx vitest run tests/parse.test.ts        # pure unit tests, instant
DAYTONA_API_KEY=... npx vitest run        # + integration (creates a sandbox)
```
