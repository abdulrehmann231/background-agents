# MCP Integration Plan

## Problem Statement

Agents running in sandboxes cannot access GitHub issues, PRs, and other GitHub resources because:
1. The GitHub token (from user's OAuth) is stored server-side
2. Sharing tokens directly with agents is a **security risk**
3. Agents need authenticated GitHub access for useful operations

**Key Requirement**: Tokens must NEVER be accessible to agents.

## Solution: Self-Hosted MCP Server with Smithery SDK

Implement an MCP server using **Smithery SDK** that runs **server-side** (not in the sandbox). This provides:
- Secure token isolation (tokens never leave the server)
- Extensible architecture (easy to add Jira, Slack, Linear, etc. later)
- Per-chat opt-in (users explicitly enable tools per chat)
- Standard MCP protocol for agent compatibility

### Why Smithery SDK?

1. **Extensibility** - Easy to add more tool providers (Jira, Slack, Linear) later
2. **Single MCP Server** - One endpoint serves all tools, agents connect once
3. **Community Tools** - Can integrate tools from Smithery registry if needed
4. **Production Ready** - Battle-tested SDK for MCP servers

### Why NOT Smithery Hosted?

Smithery offers hosted MCP servers, but that would send tokens to their infrastructure. By self-hosting with their SDK, tokens stay on YOUR server.

---

## Security Model: Token Isolation

```
┌─────────────────────────────────────────────────────────────┐
│                     YOUR SERVER                              │
│                                                              │
│   1. Agent calls: github_get_issue(123)                     │
│                   ───────────────────►                       │
│                   (NO token in request)                      │
│                                                              │
│   2. Server internally:                                      │
│      sandboxId → Chat → userId → Account → access_token     │
│                                                              │
│   3. Server calls GitHub API with token                     │
│                                                              │
│   4. Returns result (issue data, NO token)                  │
│                   ◄───────────────────                       │
│                                                              │
│   Token: 🔒 NEVER LEAVES THIS BOX                           │
└─────────────────────────────────────────────────────────────┘
                            │
                            │  Only tool results
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                     SANDBOX (Agent)                          │
│                                                              │
│   Agent receives: { title: "Bug", body: "...", ... }        │
│                                                              │
│   Agent CANNOT:                                              │
│   ❌ See the token                                           │
│   ❌ Make arbitrary GitHub API calls                         │
│   ❌ Access other repos                                      │
│                                                              │
│   Agent CAN only:                                            │
│   ✅ Use exposed tools                                       │
│   ✅ On the chat's repo only                                 │
└─────────────────────────────────────────────────────────────┘
```

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Web Application                              │
│                                                                      │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                 MCP Server (Smithery SDK)                      │  │
│  │                 /api/mcp/[sandboxId]/sse                       │  │
│  │                                                                │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │  │
│  │  │   GitHub    │  │    Jira     │  │   Slack     │  ...       │  │
│  │  │   Tools     │  │   Tools     │  │   Tools     │  (future)  │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘            │  │
│  │                                                                │  │
│  │  Authentication:                                               │  │
│  │  1. Check Chat.mcpToolsEnabled (per-chat opt-in)              │  │
│  │  2. sandboxId → Chat → userId → Account → tokens              │  │
│  │  3. Scope operations to Chat.repo only                        │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                              ↑                                       │
│                              │ HTTP/SSE                              │
└──────────────────────────────┼───────────────────────────────────────┘
                               │
┌──────────────────────────────┼───────────────────────────────────────┐
│                    Daytona Sandbox                                    │
│                              ↓                                       │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                Agent (Claude, Codex, etc.)                     │  │
│  │                                                                │  │
│  │  MCP client connects to: https://{app}/api/mcp/{sandboxId}/sse│  │
│  │                                                                │  │
│  │  Available tools (if enabled):                                │  │
│  │  - github_list_issues          - github_get_pr_diff           │  │
│  │  - github_get_issue            - github_add_comment           │  │
│  │  - github_create_issue         - github_create_pr_review      │  │
│  │  - github_list_pull_requests   - github_search_code           │  │
│  │  - github_get_pull_request     - github_get_file_contents     │  │
│  │                                                                │  │
│  │  Token: ❌ NEVER PRESENT                                       │  │
│  └───────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Per-Chat Opt-In Feature

Users must **explicitly enable** MCP tools for each chat (similar to environment variables).

### UI Flow

```
┌─────────────────────────────────────────────────────────────┐
│                     CHAT SETTINGS                            │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Environment Variables                              │    │
│  │  [API_KEY] = [••••••••]                     [+ Add] │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  MCP Tools                                          │    │
│  │                                                      │    │
│  │  ☐ GitHub Tools                                     │    │
│  │    Access issues, PRs, comments, code search        │    │
│  │                                                      │    │
│  │  ☐ Jira Tools (coming soon)                         │    │
│  │    Access issues, projects, sprints                 │    │
│  │                                                      │    │
│  │  ☐ Slack Tools (coming soon)                        │    │
│  │    Send messages, read channels                     │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
│                                    [Save Settings]          │
└─────────────────────────────────────────────────────────────┘
```

### Database Schema Change

```prisma
model Chat {
  // ... existing fields ...

  // MCP tools configuration (JSONB for flexibility)
  // { github: true, jira: false, slack: false }
  mcpTools Json?
}
```

Using JSONB allows easy extension for new tool providers without migrations.

### Validation on MCP Endpoint

```typescript
// /api/mcp/[sandboxId]/sse/route.ts

const chat = await prisma.chat.findUnique({
  where: { sandboxId },
  select: { mcpTools: true, repo: true, userId: true }
})

// Check if GitHub tools enabled for this chat
const mcpTools = chat.mcpTools as { github?: boolean } | null
if (!mcpTools?.github) {
  return new Response("GitHub tools not enabled for this chat", { status: 403 })
}
```

---

## Implementation Steps

### Phase 1: MCP Server Package (Smithery SDK)

#### 1.1 Create MCP Server Package
**File: `packages/mcp-server/package.json`**
```json
{
  "name": "@anthropic/mcp-server",
  "version": "0.1.0",
  "dependencies": {
    "@smithery-ai/mcp-sdk": "^1.x",
    "@octokit/rest": "^20.x"
  }
}
```

#### 1.2 Create Tool Provider Interface
**File: `packages/mcp-server/src/providers/base.ts`**
```typescript
export interface ToolProvider {
  name: string
  tools: ToolDefinition[]
  isEnabled(chat: Chat): boolean
  getCredentials(userId: string): Promise<Credentials>
  handleToolCall(tool: string, args: unknown, ctx: Context): Promise<unknown>
}
```

#### 1.3 Implement GitHub Provider
**File: `packages/mcp-server/src/providers/github/index.ts`**
- Implements ToolProvider interface
- All GitHub tools (issues, PRs, comments, etc.)
- Uses Octokit with token from server DB

#### 1.4 Create MCP Server Core
**File: `packages/mcp-server/src/server.ts`**
- Uses Smithery SDK for MCP protocol
- HTTP/SSE transport
- Dynamically registers tools based on chat settings
- Routes tool calls to appropriate provider

### Phase 2: API Route Integration

#### 2.1 Create MCP SSE Endpoint
**File: `packages/web/app/api/mcp/[sandboxId]/sse/route.ts`**
```typescript
export async function GET(req: Request, { params }: { params: { sandboxId: string } }) {
  const { sandboxId } = params

  // 1. Look up chat and validate
  const chat = await prisma.chat.findUnique({
    where: { sandboxId },
    include: { user: { include: { accounts: true } } }
  })

  if (!chat) return new Response("Chat not found", { status: 404 })

  // 2. Check which MCP tools are enabled
  const mcpTools = chat.mcpTools as McpToolsConfig | null
  if (!mcpTools || !Object.values(mcpTools).some(Boolean)) {
    return new Response("No MCP tools enabled", { status: 403 })
  }

  // 3. Get credentials (GitHub token from Account)
  const githubAccount = chat.user.accounts.find(a => a.provider === "github")
  const githubToken = githubAccount?.access_token

  // 4. Create MCP server with enabled tools only
  const server = createMcpServer({
    enabledTools: mcpTools,
    credentials: { github: githubToken },
    repo: chat.repo,  // Scope all operations to this repo
  })

  // 5. Return SSE stream
  return server.handleSSE(req)
}
```

#### 2.2 Create MCP Message Endpoint
**File: `packages/web/app/api/mcp/[sandboxId]/message/route.ts`**
- POST endpoint for client→server MCP messages
- Same authentication logic as SSE endpoint

### Phase 3: Database & UI

#### 3.1 Update Prisma Schema
**File: `packages/web/prisma/schema.prisma`**
```prisma
model Chat {
  // ... existing fields ...

  // MCP tools enabled for this chat
  // { github: true, jira: false, slack: false }
  mcpTools Json?
}
```

#### 3.2 Create API Endpoints for Chat Settings
**File: `packages/web/app/api/chat/[id]/mcp-tools/route.ts`**
- GET: Retrieve current MCP tools settings
- PATCH: Update MCP tools settings

#### 3.3 Create UI Component
**File: `packages/web/components/chat/McpToolsSettings.tsx`**
- Toggle switches for each tool provider
- Shows available tools per provider
- Saves to chat settings

### Phase 4: Agent Configuration

#### 4.1 Configure Agent MCP Client
**File: `packages/agent-configuration/src/mcp.ts`**
```typescript
export function generateMcpConfig(sandboxId: string, baseUrl: string): McpConfig {
  return {
    mcpServers: {
      "daytona-tools": {
        transport: "sse",
        url: `${baseUrl}/api/mcp/${sandboxId}/sse`
      }
    }
  }
}
```

#### 4.2 Update Agent Setup
**File: `packages/agents/src/agents/claude/index.ts`**
- Write MCP config to `~/.claude.json` if tools enabled
- Only configure if chat.mcpTools has any enabled

#### 4.3 Update Session Creation
**File: `packages/web/lib/agent-session.ts`**
- Check if MCP tools enabled for chat
- Pass MCP configuration to agent setup

### Phase 5: Security & Hardening

#### 5.1 Request Signing (Optional Enhancement)
**File: `packages/web/lib/mcp-auth.ts`**
- Generate signed tokens for sandbox→MCP auth
- Prevents sandboxId enumeration attacks
- Short-lived tokens with HMAC signature

#### 5.2 Rate Limiting
- Per-sandbox rate limits on MCP endpoint
- Prevents GitHub API quota abuse

#### 5.3 Audit Logging
- Log all tool invocations
- Track: timestamp, userId, sandboxId, tool, params, result

---

## Files to Create

| File | Purpose |
|------|---------|
| `packages/mcp-server/package.json` | Package configuration |
| `packages/mcp-server/tsconfig.json` | TypeScript config |
| `packages/mcp-server/src/index.ts` | Package entry point |
| `packages/mcp-server/src/server.ts` | MCP server core (Smithery SDK) |
| `packages/mcp-server/src/providers/base.ts` | Tool provider interface |
| `packages/mcp-server/src/providers/github/index.ts` | GitHub tools implementation |
| `packages/mcp-server/src/providers/github/tools.ts` | GitHub tool definitions |
| `packages/mcp-server/src/types.ts` | TypeScript types |
| `packages/web/app/api/mcp/[sandboxId]/sse/route.ts` | SSE endpoint |
| `packages/web/app/api/mcp/[sandboxId]/message/route.ts` | Message endpoint |
| `packages/web/app/api/chat/[id]/mcp-tools/route.ts` | MCP settings API |
| `packages/web/components/chat/McpToolsSettings.tsx` | Settings UI component |
| `packages/web/lib/mcp-auth.ts` | MCP authentication utilities |
| `packages/agent-configuration/src/mcp.ts` | MCP config generation |

## Files to Modify

| File | Changes |
|------|---------|
| `packages/web/prisma/schema.prisma` | Add `mcpTools Json?` to Chat model |
| `packages/web/lib/agent-session.ts` | Add MCP config to session options |
| `packages/agents/src/agents/claude/index.ts` | Add MCP setup capability |
| `packages/web/package.json` | Add mcp-server dependency |
| `package.json` (root) | Add mcp-server to workspaces |

---

## GitHub Tools Specification

### 1. `github_list_issues`
```typescript
{
  name: "github_list_issues",
  description: "List issues in the repository",
  inputSchema: {
    type: "object",
    properties: {
      state: { type: "string", enum: ["open", "closed", "all"], default: "open" },
      labels: { type: "array", items: { type: "string" } },
      assignee: { type: "string" },
      creator: { type: "string" },
      since: { type: "string", format: "date-time" },
      per_page: { type: "number", default: 30, maximum: 100 },
      page: { type: "number", default: 1 }
    }
  }
}
```

### 2. `github_get_issue`
```typescript
{
  name: "github_get_issue",
  description: "Get details of a specific issue including comments",
  inputSchema: {
    type: "object",
    properties: {
      issue_number: { type: "number" },
      include_comments: { type: "boolean", default: true }
    },
    required: ["issue_number"]
  }
}
```

### 3. `github_create_issue`
```typescript
{
  name: "github_create_issue",
  description: "Create a new issue",
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string" },
      body: { type: "string" },
      labels: { type: "array", items: { type: "string" } },
      assignees: { type: "array", items: { type: "string" } }
    },
    required: ["title"]
  }
}
```

### 4. `github_update_issue`
```typescript
{
  name: "github_update_issue",
  description: "Update an existing issue",
  inputSchema: {
    type: "object",
    properties: {
      issue_number: { type: "number" },
      title: { type: "string" },
      body: { type: "string" },
      state: { type: "string", enum: ["open", "closed"] },
      labels: { type: "array", items: { type: "string" } },
      assignees: { type: "array", items: { type: "string" } }
    },
    required: ["issue_number"]
  }
}
```

### 5. `github_list_pull_requests`
```typescript
{
  name: "github_list_pull_requests",
  description: "List pull requests in the repository",
  inputSchema: {
    type: "object",
    properties: {
      state: { type: "string", enum: ["open", "closed", "all"], default: "open" },
      head: { type: "string" },
      base: { type: "string" },
      sort: { type: "string", enum: ["created", "updated", "popularity"], default: "created" },
      direction: { type: "string", enum: ["asc", "desc"], default: "desc" },
      per_page: { type: "number", default: 30, maximum: 100 }
    }
  }
}
```

### 6. `github_get_pull_request`
```typescript
{
  name: "github_get_pull_request",
  description: "Get details of a specific pull request",
  inputSchema: {
    type: "object",
    properties: {
      pull_number: { type: "number" },
      include_diff: { type: "boolean", default: false },
      include_comments: { type: "boolean", default: true }
    },
    required: ["pull_number"]
  }
}
```

### 7. `github_get_pr_diff`
```typescript
{
  name: "github_get_pr_diff",
  description: "Get the diff/changed files for a pull request",
  inputSchema: {
    type: "object",
    properties: {
      pull_number: { type: "number" }
    },
    required: ["pull_number"]
  }
}
```

### 8. `github_add_comment`
```typescript
{
  name: "github_add_comment",
  description: "Add a comment to an issue or pull request",
  inputSchema: {
    type: "object",
    properties: {
      issue_number: { type: "number" },
      body: { type: "string" }
    },
    required: ["issue_number", "body"]
  }
}
```

### 9. `github_search_code`
```typescript
{
  name: "github_search_code",
  description: "Search for code in the repository",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string" },
      path: { type: "string" },
      extension: { type: "string" }
    },
    required: ["query"]
  }
}
```

### 10. `github_get_file_contents`
```typescript
{
  name: "github_get_file_contents",
  description: "Get contents of a file at a specific ref (branch/tag/commit)",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string" },
      ref: { type: "string", description: "Branch, tag, or commit SHA" }
    },
    required: ["path"]
  }
}
```

### 11. `github_create_pr_review`
```typescript
{
  name: "github_create_pr_review",
  description: "Create a review on a pull request",
  inputSchema: {
    type: "object",
    properties: {
      pull_number: { type: "number" },
      body: { type: "string" },
      event: { type: "string", enum: ["APPROVE", "REQUEST_CHANGES", "COMMENT"] },
      comments: {
        type: "array",
        items: {
          type: "object",
          properties: {
            path: { type: "string" },
            line: { type: "number" },
            body: { type: "string" }
          },
          required: ["path", "line", "body"]
        }
      }
    },
    required: ["pull_number", "event"]
  }
}
```

### 12. `github_list_branches`
```typescript
{
  name: "github_list_branches",
  description: "List branches in the repository",
  inputSchema: {
    type: "object",
    properties: {
      protected_only: { type: "boolean", default: false },
      per_page: { type: "number", default: 30, maximum: 100 }
    }
  }
}
```

---

## Security Considerations

### Token Isolation
- GitHub tokens NEVER leave the server
- Sandbox only knows the MCP endpoint URL
- Authentication happens via sandboxId lookup server-side

### Per-Chat Opt-In
- Tools disabled by default
- User must explicitly enable per chat
- Can be revoked anytime

### Scoped Access
- MCP server only allows operations on the chat's associated repo
- Cross-repo access explicitly denied
- `owner/repo` extracted from Chat record and enforced

### Request Validation
- Validate sandboxId exists and maps to valid chat
- Verify chat belongs to authenticated user (via sandbox ownership)
- Check mcpTools settings before allowing any tool call

### Audit Trail
- All tool invocations logged with:
  - Timestamp
  - User ID
  - Sandbox ID
  - Chat ID
  - Tool name
  - Parameters (sanitized)
  - Result status
  - Response time

---

## Future Extensions

### Additional Tool Providers

The modular architecture makes it easy to add:

```typescript
// packages/mcp-server/src/providers/jira/index.ts
export class JiraProvider implements ToolProvider {
  name = "jira"
  tools = [
    "jira_list_issues",
    "jira_get_issue",
    "jira_create_issue",
    "jira_add_comment",
    // ...
  ]
}

// packages/mcp-server/src/providers/slack/index.ts
export class SlackProvider implements ToolProvider {
  name = "slack"
  tools = [
    "slack_send_message",
    "slack_list_channels",
    // ...
  ]
}

// packages/mcp-server/src/providers/linear/index.ts
export class LinearProvider implements ToolProvider {
  name = "linear"
  tools = [
    "linear_list_issues",
    "linear_create_issue",
    // ...
  ]
}
```

Each provider:
1. Implements the `ToolProvider` interface
2. Gets registered in the MCP server
3. Appears in the UI toggle
4. Gets its own credential storage

### User-Configurable Permissions
- Allow users to enable/disable specific tools within a provider
- Example: Enable `github_list_issues` but disable `github_create_issue`

### Organization-Level Defaults
- Org admins can set default tool settings for all chats
- Individual users can override if permitted

---

## Implementation Order

### Phase 1: Core Infrastructure (~3 days)
- [ ] Create `packages/mcp-server` with Smithery SDK
- [ ] Implement GitHub provider with all tools
- [ ] Create MCP server with HTTP/SSE transport

### Phase 2: API Integration (~2 days)
- [ ] Create `/api/mcp/[sandboxId]/sse` endpoint
- [ ] Create `/api/mcp/[sandboxId]/message` endpoint
- [ ] Implement authentication & scoping logic

### Phase 3: Database & Settings (~1 day)
- [ ] Add `mcpTools` column to Chat model
- [ ] Create API for updating chat MCP settings
- [ ] Run migration

### Phase 4: UI (~1 day)
- [ ] Create McpToolsSettings component
- [ ] Integrate into chat settings panel
- [ ] Add toggle state management

### Phase 5: Agent Configuration (~1 day)
- [ ] Generate MCP config for Claude Code
- [ ] Update agent setup to write config if enabled
- [ ] Test end-to-end connection

### Phase 6: Hardening (~1 day)
- [ ] Add rate limiting
- [ ] Add audit logging
- [ ] Security review

**Total Estimated Time: ~9 days**

---

## Testing Strategy

### Unit Tests
- Tool handler functions
- Authentication logic
- Settings validation
- Rate limiting

### Integration Tests
- MCP protocol communication
- SSE endpoint streaming
- Tool call routing
- Settings persistence

### End-to-End Tests
- Enable tools in UI → verify agent can use them
- Disable tools → verify agent cannot access
- Test each GitHub tool with real API

### Security Tests
- Verify tokens never exposed in responses
- Verify cross-repo access denied
- Verify disabled tools return 403
- Test sandboxId enumeration protection
