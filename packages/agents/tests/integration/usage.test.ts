/**
 * Integration tests for per-turn token usage & cost (tokscale).
 *
 * These create real Daytona sandboxes, install tokscale, run one real turn per
 * provider, and assert that getTurnUsage() (and the streamed UsageEvent) return
 * non-zero tokens + cost. Skipped when required API keys are not set.
 *
 * NOTE: the default Daytona sandbox is NOT the rebuilt `background-agents`
 * snapshot, so tokscale is installed at runtime here. Once the snapshot ships
 * with tokscale pre-installed, the install step below becomes a no-op.
 *
 * Required env vars per agent (TEST_ prefixed versions take precedence):
 *   - claude:   DAYTONA_API_KEY, ANTHROPIC_API_KEY
 *   - codex:    DAYTONA_API_KEY, OPENAI_API_KEY
 *   - gemini:   DAYTONA_API_KEY, GEMINI_API_KEY (or GOOGLE_API_KEY)
 *   - goose:    DAYTONA_API_KEY, OPENAI_API_KEY
 *   - opencode: DAYTONA_API_KEY, ANTHROPIC_API_KEY
 *
 * Run:
 *   DAYTONA_API_KEY=... ANTHROPIC_API_KEY=... OPENAI_API_KEY=... GEMINI_API_KEY=... \
 *     npm test -w @background-agents/sdk -- tests/integration/usage.test.ts
 */
import "dotenv/config"
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { Daytona, type Sandbox } from "@daytonaio/sdk"
import {
  createSession,
  type Event,
  type UsageEvent,
  type BackgroundSession,
} from "../../src/index.js"

const DAYTONA_API_KEY =
  process.env.TEST_DAYTONA_API_KEY || process.env.DAYTONA_API_KEY
const ANTHROPIC_API_KEY =
  process.env.TEST_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY
const OPENAI_API_KEY =
  process.env.TEST_OPENAI_API_KEY || process.env.OPENAI_API_KEY
const GEMINI_API_KEY =
  process.env.TEST_GEMINI_API_KEY ||
  process.env.TEST_GOOGLE_API_KEY ||
  process.env.GEMINI_API_KEY ||
  process.env.GOOGLE_API_KEY

// A prompt big enough to guarantee non-zero token accounting.
const PROMPT = "In one short sentence, what is the capital of France?"

const agents = [
  {
    name: "claude" as const,
    apiKeyEnvVar: "ANTHROPIC_API_KEY",
    apiKey: ANTHROPIC_API_KEY,
    hasKey: !!ANTHROPIC_API_KEY,
  },
  {
    name: "codex" as const,
    apiKeyEnvVar: "OPENAI_API_KEY",
    apiKey: OPENAI_API_KEY,
    hasKey: !!OPENAI_API_KEY,
  },
  {
    name: "gemini" as const,
    apiKeyEnvVar: "GEMINI_API_KEY",
    apiKey: GEMINI_API_KEY,
    hasKey: !!GEMINI_API_KEY,
  },
  {
    name: "goose" as const,
    apiKeyEnvVar: "OPENAI_API_KEY",
    apiKey: OPENAI_API_KEY,
    hasKey: !!OPENAI_API_KEY,
    model: "gpt-4o",
  },
  {
    name: "opencode" as const,
    apiKeyEnvVar: "ANTHROPIC_API_KEY",
    apiKey: ANTHROPIC_API_KEY,
    hasKey: !!ANTHROPIC_API_KEY,
    model: "anthropic/claude-sonnet-4-6",
  },
]

async function pollUntilEnd(
  session: BackgroundSession,
  timeoutMs = 120_000,
  pollIntervalMs = 2000
): Promise<Event[]> {
  const deadline = Date.now() + timeoutMs
  const all: Event[] = []
  while (Date.now() < deadline) {
    const { events, running } = await session.getEvents()
    all.push(...events)
    if (!running || events.some((e) => e.type === "end")) break
    await new Promise((r) => setTimeout(r, pollIntervalMs))
  }
  return all
}

describe.skipIf(!DAYTONA_API_KEY)("per-turn usage integration", () => {
  for (const agent of agents) {
    const hasRequiredKeys = DAYTONA_API_KEY && agent.hasKey

    describe.skipIf(!hasRequiredKeys)(`${agent.name}`, () => {
      let daytona: Daytona
      let sandbox: Sandbox

      beforeAll(async () => {
        daytona = new Daytona({ apiKey: DAYTONA_API_KEY! })
        sandbox = await daytona.create({
          envVars: { [agent.apiKeyEnvVar]: agent.apiKey! },
        })
        // Install tokscale (default sandbox isn't the rebuilt snapshot).
        const res = await sandbox.process.executeCommand(
          "npm install -g tokscale && tokscale --version",
          undefined,
          undefined,
          300
        )
        if ((res.exitCode ?? 0) !== 0) {
          throw new Error(`tokscale install failed: ${res.result}`)
        }
      }, 360_000)

      afterAll(async () => {
        if (sandbox) await sandbox.delete()
      }, 30_000)

      it("reports non-zero tokens and cost for one turn", async () => {
        const session = await createSession(agent.name, {
          sandbox,
          timeout: 120,
          model: agent.model,
          env: { [agent.apiKeyEnvVar]: agent.apiKey! },
        })

        await session.start(PROMPT)
        const events = await pollUntilEnd(session)
        expect(events.some((e) => e.type === "end")).toBe(true)

        // 1) The streamed UsageEvent should be present on completion.
        const streamed = events.find((e) => e.type === "usage") as
          | UsageEvent
          | undefined

        // 2) getTurnUsage() should return the same cached delta.
        const usage = await session.getTurnUsage()

        // eslint-disable-next-line no-console
        console.log(`[usage:${agent.name}]`, JSON.stringify(usage))

        expect(usage, "getTurnUsage() returned null").not.toBeNull()
        expect(usage!.provider).toBe(agent.name)
        expect(usage!.totalTokens).toBeGreaterThan(0)
        expect(
          usage!.inputTokens + usage!.outputTokens
        ).toBeGreaterThan(0)
        // All five providers here hit paid APIs, so cost must be priced.
        expect(usage!.costUSD, "cost not priced").toBeGreaterThan(0)

        // The streamed event (when present) must agree with getTurnUsage().
        if (streamed) {
          expect(streamed.totalTokens).toBe(usage!.totalTokens)
        }
      }, 240_000)

      it("attributes a second turn separately (diff, not cumulative)", async () => {
        const session = await createSession(agent.name, {
          sandbox,
          timeout: 120,
          model: agent.model,
          env: { [agent.apiKeyEnvVar]: agent.apiKey! },
        })

        // Turn A
        await session.start(PROMPT)
        await pollUntilEnd(session)
        const a = await session.getTurnUsage()

        // Turn B (resume same session)
        await session.start("Now name one famous landmark there.")
        await pollUntilEnd(session)
        const b = await session.getTurnUsage()

        // eslint-disable-next-line no-console
        console.log(
          `[usage:${agent.name}] turnA=${a?.totalTokens} turnB=${b?.totalTokens}`
        )

        expect(a).not.toBeNull()
        expect(b).not.toBeNull()
        // Turn B is its own delta, not the running cumulative total.
        expect(b!.totalTokens).toBeGreaterThan(0)
      }, 300_000)
    })
  }
})
