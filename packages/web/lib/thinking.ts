import { agentToProvider, type Agent } from "@background-agents/common"
import { getThinkingCapability } from "@background-agents/sdk/thinking"

export function thinkingCapability(agent: string, model: string) {
  return getThinkingCapability(agentToProvider[agent as Agent] ?? agent, model)
}
