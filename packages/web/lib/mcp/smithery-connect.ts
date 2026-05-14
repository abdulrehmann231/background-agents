/**
 * Smithery Connect — connection lifecycle helpers.
 *
 * This file maintains backwards compatibility for existing imports while
 * delegating to the shared mcp-providers package.
 */

import {
  createSmitheryProvider,
  isSmitheryServer,
  getSmitheryConnectionId,
  type ConnectionResult,
} from "@upstream/mcp-providers"

// Re-export types and utilities from mcp-providers
export type { ConnectionResult as SmitheryConnectionResult }
export { isSmitheryServer, getSmitheryConnectionId }

// Lazily-initialized provider instance using env vars
let provider: ReturnType<typeof createSmitheryProvider> | null = null

function getProvider(apiKey: string) {
  // Always use provided apiKey, but cache if it matches env var
  const envApiKey = process.env.SMITHERY_API_KEY
  const namespace = process.env.SMITHERY_NAMESPACE

  if (provider && envApiKey === apiKey) {
    return provider
  }

  const newProvider = createSmitheryProvider({ apiKey, namespace })

  // Only cache if using the env var API key
  if (envApiKey === apiKey) {
    provider = newProvider
  }

  return newProvider
}

/**
 * Create or refresh a Smithery Connect connection for `mcpUrl`.
 * Idempotent — calling twice with the same connectionId updates in place.
 */
export async function createSmitheryConnection(
  mcpUrl: string,
  connectionId: string,
  name: string,
  apiKey: string
): Promise<ConnectionResult> {
  const smithery = getProvider(apiKey)
  return smithery.createConnection(mcpUrl, connectionId, name)
}

/** Delete the Smithery connection (best-effort) when a row is removed. */
export async function deleteSmitheryConnection(
  connectionId: string,
  apiKey: string
): Promise<void> {
  const smithery = getProvider(apiKey)
  await smithery.deleteConnection(connectionId)
}
