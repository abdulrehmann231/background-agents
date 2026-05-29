# Agent instructions

Primary reference for coding agents working in this repo.

- **Running dev / tests**: [DEVELOPMENT.md](./DEVELOPMENT.md)
- **Architecture, env, deployment**: [`packages/web/README.md`](./packages/web/README.md)

## What the user has to provide

The agent can follow the setup and workflow instructions in this repo on its own, but the user must provide values for these env vars when required by setting them in the current environment.

**Required for dev server and tests**

- `DAYTONA_API_KEY` in `.env.local` (reused by `.env.test`).

**Required for dev server**

- Auth: either `GITHUB_CLIENT_ID` + `GITHUB_CLIENT_SECRET`, or `GITHUB_PAT` as an alternative.

**Optional** (only if those integrations are in scope)

- `SMITHERY_*` — remote MCP servers from the Smithery registry.
- `GITHUB_APP_*` — authenticated GitHub MCP server.

## Debugging

- Investigate with console logs first — add them liberally to narrow down where behavior diverges from expectation, then remove the ones that didn't pay off.
- Prefer broad integration tests and end-to-end tests over narrow unit tests. They catch real bugs and survive refactors.
- When debugging, write a new test that reproduces the failure before fixing it. The fix isn't trusted until the test goes red → green.
- After fixing, keep only the broad tests. Delete narrow tests written just to isolate the bug — they become maintenance cost without adding coverage the broad tests don't already give.

## After editing code

Before running typecheck for the first time (or after pulling new changes), ensure dependencies are installed:

```bash
npm install
npm run prisma:generate
```

Then run `npm run typecheck` to verify there are no type errors. This is much faster than a full build (~5 seconds vs 2-3 minutes).
