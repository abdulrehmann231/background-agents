"use client"

import { X } from "lucide-react"
import { cn } from "@/lib/utils"
import { RepoCombobox } from "@/components/chat/RepoCombobox"
import { BranchCombobox } from "@/components/chat/BranchCombobox"
import { McpServersCombobox } from "@/components/chat/McpServersCombobox"
import type { Agent, ModelOption } from "@/lib/types"
import { JobAgentModelMenu } from "./JobAgentModelMenu"

interface JobPromptFieldProps {
  prompt: string
  setPrompt: (v: string) => void
  isMobile: boolean
  // Repo / branch
  repo: string
  setRepo: (v: string) => void
  baseBranch: string
  setBaseBranch: (v: string) => void
  isEditing: boolean
  // MCP picker materialization
  materializedJobId: string | null
  jobId?: string
  onMaterializeDraft: (draftId: string) => Promise<string | null>
  // Agent / model
  agent: Agent
  setAgent: (a: Agent) => void
  model: string
  setModel: (m: string) => void
  availableModels: ModelOption[]
}

/**
 * The prompt textarea plus the ChatInput-style bottom bar carrying the
 * repo/branch/MCP pickers and the agent/model selectors.
 */
export function JobPromptField({
  prompt,
  setPrompt,
  isMobile,
  repo,
  setRepo,
  baseBranch,
  setBaseBranch,
  isEditing,
  materializedJobId,
  jobId,
  onMaterializeDraft,
  agent,
  setAgent,
  model,
  setModel,
  availableModels,
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
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="What should the agent do?"
            rows={4}
            className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none resize-none"
          />
        </div>

        {/* Bottom bar with selectors. The container wrappers mirror ChatInput
            so the inner pickers can reveal labels and counts at the right
            widths via container queries. */}
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

            {/* Clear-repo X — only in create mode; edits keep the repo
                immutable since the sandbox/branch pipeline is already wired
                to it. */}
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

            {/* MCP servers picker — inline alongside repo/branch like the chat
                input. In create mode the first click materializes the job so
                the picker has a real id; cancel cleans up. */}
            <McpServersCombobox
              entityId={materializedJobId ?? jobId ?? "draft"}
              apiBase="/api/scheduled-jobs"
              isDraft={!isEditing && !materializedJobId}
              onMaterializeDraft={onMaterializeDraft}
              isMobile={isMobile}
            />
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          <JobAgentModelMenu
            agent={agent}
            onAgentChange={setAgent}
            model={model}
            onModelChange={setModel}
            availableModels={availableModels}
          />
        </div>
      </div>
    </div>
  )
}
