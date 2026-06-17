import { Daytona } from "@daytonaio/sdk"
import {
  getAgentSandboxImage,
  SNAPSHOT_NAME,
  SNAPSHOT_RESOURCES,
} from "../src/index"

// Builds (or rebuilds) the named Daytona snapshot used for agent sandboxes.
// Mirrors the weekly cron at packages/web/app/api/cron/rebuild-snapshot.
async function main() {
  const apiKey = process.env.DAYTONA_API_KEY
  if (!apiKey) {
    console.error("DAYTONA_API_KEY is not set")
    process.exit(1)
  }

  const daytona = new Daytona({ apiKey })

  // Snapshot names are unique per org, so rebuilding means delete-then-create.
  // Deletion is asynchronous, so wait until the name is free before recreating.
  try {
    const existing = await daytona.snapshot.get(SNAPSHOT_NAME)
    console.log(`Deleting existing snapshot "${SNAPSHOT_NAME}"...`)
    await daytona.snapshot.delete(existing)

    const deadline = Date.now() + 120_000
    while (Date.now() < deadline) {
      try {
        await daytona.snapshot.get(SNAPSHOT_NAME)
        await new Promise((r) => setTimeout(r, 3_000))
      } catch {
        break // get() throws once the snapshot is gone
      }
    }
  } catch {
    // No existing snapshot — first build.
  }

  console.log(`Building snapshot "${SNAPSHOT_NAME}" (this can take several minutes)...`)
  const snapshot = await daytona.snapshot.create(
    {
      name: SNAPSHOT_NAME,
      image: getAgentSandboxImage(),
      resources: SNAPSHOT_RESOURCES,
    },
    { onLogs: (line) => console.log(line) }
  )

  console.log(`Built snapshot: ${snapshot.name}`)
}

main().catch((err) => {
  console.error("Snapshot build failed:", err)
  process.exit(1)
})
