import type { ParseContext } from "../../src/core/agent.js"

// Helper to create a fresh parse context
export function createContext(): ParseContext {
  return { state: {}, sessionId: null }
}
