# Agent instructions

Primary reference for coding agents working in this repo.

- **Running dev / tests**: [DEVELOPMENT.md](./DEVELOPMENT.md)

For **architecture, env-by-situation, and deployment**, see [`packages/web/README.md`](./packages/web/README.md).

## What the agent does on its own

The agent should do these without asking, assuming dependencies are installed:

- Edit code, including `prisma/schema.prisma`.
- Run `npm install` and `npm run prisma:generate` after pulling or when deps change.
- Run `npm run typecheck` to verify changes (~5s vs 2–3 min for a full build).
- Run `npm run prisma:migrate` against the local dev DB and commit the generated migration file in `prisma/migrations/`.
- Run `npm run test:e2e` from `packages/web/` once `.env.test` and the test DB exist (see below).
- Commit changes on the current branch. Never amend, rebase, or rewrite history.

## What the user has to do

The agent cannot do these and should stop and ask:

- **First-time Postgres setup.** Installing Postgres and creating the `sandboxed` user + `sandboxed_agents` / `sandboxed_agents_test` databases requires `sudo` and is a one-time host setup — see [DEVELOPMENT.md](./DEVELOPMENT.md#database-setup).
- **Provide real secrets.** The agent must never invent values for these; they have to come from the user (or be left as placeholders the user fills in):
  - `DAYTONA_API_KEY` in `.env.local` (reused by `.env.test`).
  - `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`, or `GITHUB_PAT` as an alternative.
  - `NEXTAUTH_SECRET`, and `ENCRYPTION_KEY` for any non-dev deployment.
  - Anything under `SMITHERY_*` or `GITHUB_APP_*` if those integrations are in scope.
- **Reproduce a failing E2E test in a browser.** The agent can start `npm run dev:test` on http://localhost:4000, but a human has to click through the failing flow.
- **Push, open PRs, merge, deploy.** The agent commits but does not push. PRs, merges, rebases, and Vercel deploys are user-driven (`/pr`, `/merge`, `/rebase`).
- **Scope / architecture decisions.** When a change has more than one reasonable shape, ask before picking one.

## After editing code

Before running typecheck for the first time (or after pulling new changes), ensure dependencies are installed:

```bash
npm install
npm run prisma:generate
```

Then run `npm run typecheck` to verify there are no type errors. This is much faster than a full build (~5 seconds vs 2-3 minutes).
