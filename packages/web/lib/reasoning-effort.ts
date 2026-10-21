import { agentToProvider, type Agent } from "@background-agents/common"
import { getReasoningEffortCapability } from "@background-agents/sdk/reasoning-effort"

export function reasoningEffortCapability(agent: string, model: string) {
  return getReasoningEffortCapability(agentToProvider[agent as Agent] ?? agent, model)
}
