"use client"

import { X } from "lucide-react"
import { cn } from "@/lib/utils"
import { RepoCombobox } from "@/components/chat/RepoCombobox"
import { BranchCombobox } from "@/components/chat/BranchCombobox"
import { McpServersCombobox } from "@/components/chat/McpServersCombobox"
import { AgentModelControls } from "@/components/scheduled-jobs/AgentModelControls"
import { type Agent } from "@/lib/types"

interface JobPromptFieldProps {
  prompt: string
  onPromptChange: (value: string) => void
  repo: string
  setRepo: (value: string) => void
  baseBranch: string
  setBaseBranch: (value: string) => void
  isEditing: boolean
  /** Entity the MCP picker hangs connections off of (materialized id, job id, or "draft"). */
  mcpEntityId: string
  /** True while the row only exists client-side, so the MCP picker materializes on first use. */
  mcpIsDraft: boolean
  onMaterializeDraft: (draftId: string) => Promise<string | null>
  agent: Agent
  model: string
  onAgentChange: (agent: Agent) => void
  onModelChange: (model: string) => void
  isMobile: boolean
}

/**
 * Prompt textarea plus the ChatInput-style bottom bar (repo / branch / MCP on
 * the left, agent + model pickers on the right).
 */
export function JobPromptField({
  prompt,
  onPromptChange,
  repo,
  setRepo,
  baseBranch,
  setBaseBranch,
  isEditing,
  mcpEntityId,
  mcpIsDraft,
  onMaterializeDraft,
  agent,
  model,
  onAgentChange,
  onModelChange,
  isMobile,
}: JobPromptFieldProps) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1">Prompt</label>
      <div className={cn(
        "relative flex flex-col border shadow-sm bg-card border-border",
        isMobile ? "rounded-xl" : "rounded-2xl",
        "focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20"
      )}>
        {/* Textarea */}
        <div className={cn(isMobile ? "px-3 py-2" : "px-4 py-3")}>
          <textarea
            value={prompt}
            onChange={(e) => onPromptChange(e.target.value)}
            placeholder="What should the agent do?"
            rows={4}
            className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none resize-none"
          />
        </div>

        {/* Bottom bar with selectors. The container wrappers mirror
            ChatInput so the inner pickers can reveal labels and counts
            at the right widths via container queries. */}
        <div className={cn(
          "@container flex items-center",
          isMobile ? "gap-2 px-3 py-2" : "gap-3 px-4 py-2"
        )}>
          {/* Left side items (repo / branch / MCP) */}
          <div className={cn(
            "flex items-center gap-2",
            isMobile ? "w-full @container/row1" : "flex-1"
          )}>
            {/* Repo selector */}
            <RepoCombobox
              value={repo || null}
              onChange={(newRepo, defaultBranch) => {
                setRepo(newRepo)
                setBaseBranch(defaultBranch)
              }}
              disabled={isEditing}
              isMobile={isMobile}
              showLabel
            />

            {/* Clear-repo X — only in create mode; edits keep the
                repo immutable since the sandbox/branch pipeline is
                already wired to it. */}
            {repo && !isEditing && (
              <button
                type="button"
                onClick={() => {
                  setRepo("")
                  setBaseBranch("main")
                }}
                className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer p-0.5"
                title="Remove repository"
              >
                <X className="h-3 w-3" />
              </button>
            )}

            {/* Branch selector — only meaningful when a repo is set. */}
            {repo && (
              <BranchCombobox
                repo={repo}
                value={baseBranch}
                onChange={setBaseBranch}
                defaultBranch={baseBranch}
                isMobile={isMobile}
                showLabel
              />
            )}

            {/* MCP servers picker — inline alongside repo/branch like
                the chat input. In create mode the first click
                materializes the job so the picker has a real id;
                cancel cleans up. */}
            <McpServersCombobox
              entityId={mcpEntityId}
              apiBase="/api/scheduled-jobs"
              isDraft={mcpIsDraft}
              onMaterializeDraft={onMaterializeDraft}
              isMobile={isMobile}
            />
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Agent + model pickers */}
          <AgentModelControls
            agent={agent}
            model={model}
            onAgentChange={onAgentChange}
            onModelChange={onModelChange}
          />
        </div>
      </div>
    </div>
  )
}
