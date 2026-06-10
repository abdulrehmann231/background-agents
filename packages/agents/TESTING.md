# Agent SDK Testing

This document describes how to run unit tests and integration tests for the Agent SDK.

---

## JSONL reference files

Raw JSONL output from each provider CLI is captured in `packages/agents/tests/fixtures/jsonl-reference/`. To regenerate:

```bash
npm run generate:jsonl-refs -w @background-agents/sdk
```

These fixtures are used as samples to verify that the agents are working and to analyze their output formats.

**Important:** Never generate stub or placeholder reference files. Always use real data captured from actual agent runs. If API keys are not available, the reference files should remain missing until they can be properly generated.

---

## Unit tests

Unit tests need no database and no env files.

Run the command below from the repo root.

```bash
npm run test -w @background-agents/sdk
```

---

## Agent SDK integration tests

Integration tests run each provider (Claude, Codex, Gemini, Goose, OpenCode, Pi) in real Daytona sandboxes. Tests are skipped when required API keys are not set.

Run the command below from the repo root.

```bash
npm test -w @background-agents/sdk -- tests/integration
```

### Using TEST_ prefixed API keys

The tests use `TEST_` prefixed environment variables (e.g., `TEST_OPENAI_API_KEY`) to avoid conflicts with running agents. These take precedence over the non-prefixed versions.

Supported prefixed keys:
- `TEST_DAYTONA_API_KEY`
- `TEST_ANTHROPIC_API_KEY`
- `TEST_OPENAI_API_KEY`
- `TEST_GEMINI_API_KEY` / `TEST_GOOGLE_API_KEY`

### Per-turn usage & cost (tokscale)

`tests/integration/usage.test.ts` validates per-turn token usage + cost end to
end: it runs one real turn per provider, then asserts `getTurnUsage()` (and the
streamed `UsageEvent`) return non-zero tokens and a priced cost. It also runs a
second turn to confirm per-turn attribution is a diff, not the running total.

The default Daytona sandbox is not the rebuilt `background-agents` snapshot, so
the test installs `tokscale` at runtime. Run only this file with:

```bash
DAYTONA_API_KEY=... ANTHROPIC_API_KEY=... OPENAI_API_KEY=... GEMINI_API_KEY=... \
  npm test -w @background-agents/sdk -- tests/integration/usage.test.ts
```

Each provider is skipped unless its key is present (see the header in the test
for the per-provider key matrix). Captured usage is printed as
`[usage:<provider>] {...}` for inspection.

### Debugging

Set `CODING_AGENTS_DEBUG=1` to enable verbose debug output during test runs. This will print additional logging information useful for troubleshooting agent behavior.
