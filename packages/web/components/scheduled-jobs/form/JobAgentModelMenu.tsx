"use client"

import { useState, useEffect } from "react"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { agentLabels, getModelLabel, type Agent, type ModelOption } from "@/lib/types"
import { AgentIcon } from "@/components/icons/agent-icons"
import { AVAILABLE_AGENTS } from "./constants"

interface JobAgentModelMenuProps {
  agent: Agent
  onAgentChange: (agent: Agent) => void
  model: string
  onModelChange: (model: string) => void
  availableModels: ModelOption[]
}

/**
 * Agent and model picker rendered in the prompt field's bottom bar. Owns its
 * own dropdown open/close state and closes on outside click — mirroring the
 * chat input's selectors but without the credential-gating that one carries.
 */
export function JobAgentModelMenu({
  agent,
  onAgentChange,
  model,
  onModelChange,
  availableModels,
}: JobAgentModelMenuProps) {
  const [showAgentDropdown, setShowAgentDropdown] = useState(false)
  const [showModelDropdown, setShowModelDropdown] = useState(false)

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('[data-dropdown]')) {
        setShowAgentDropdown(false)
        setShowModelDropdown(false)
      }
    }
    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [])

  const handleAgentChange = (newAgent: Agent) => {
    onAgentChange(newAgent)
    setShowAgentDropdown(false)
  }

  const handleModelChange = (newModel: string) => {
    onModelChange(newModel)
    setShowModelDropdown(false)
  }

  return (
    <>
      {/* Agent selector */}
      <div className="relative" data-dropdown>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setShowAgentDropdown(!showAgentDropdown)
            setShowModelDropdown(false)
          }}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          title={agentLabels[agent]}
        >
          <AgentIcon agent={agent} className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{agentLabels[agent]}</span>
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
        {showAgentDropdown && (
          <div className="absolute bottom-full right-0 mb-1 bg-popover border border-border rounded-md shadow-lg py-1 z-50 w-40">
            {AVAILABLE_AGENTS.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => handleAgentChange(a)}
                className={cn(
                  "w-full text-left hover:bg-accent transition-colors flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer",
                  a === agent && "bg-accent"
                )}
              >
                <AgentIcon agent={a} className="h-3.5 w-3.5" />
                {agentLabels[a]}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Model selector */}
      <div className="relative" data-dropdown>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setShowModelDropdown(!showModelDropdown)
            setShowAgentDropdown(false)
          }}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          title={getModelLabel(agent, model)}
        >
          <span className="hidden sm:inline">{getModelLabel(agent, model)}</span>
          <span className="sm:hidden">Model</span>
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
        {showModelDropdown && (
          <div className="absolute bottom-full right-0 mb-1 max-h-64 overflow-y-auto bg-popover border border-border rounded-md shadow-lg py-1 z-50 w-52">
            {availableModels.map((m) => (
              <button
                key={m.value}
                type="button"
                onClick={() => handleModelChange(m.value)}
                className={cn(
                  "w-full text-left hover:bg-accent transition-colors px-3 py-1.5 text-sm cursor-pointer",
                  m.value === model && "bg-accent"
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
