/**
 * Server-only helpers for user-defined custom endpoints.
 *
 * Endpoints are stored on `User.customEndpoints` as a JSONB array. Every field is
 * plaintext except `headers`, which can carry auth and is encrypted at rest. These
 * helpers convert between the stored shape (headers encrypted) and the runtime
 * `CustomEndpoint` shape (headers decrypted) used by @background-agents/common.
 *
 * Must never be imported from client code.
 */

import { prisma } from "@/lib/db/prisma"
import { encrypt, decrypt } from "@/lib/db/encryption"
import type { CustomEndpoint, CustomEndpointType } from "@background-agents/common"

const ENDPOINT_TYPES: readonly CustomEndpointType[] = ["anthropic", "codex", "opencode"]

function isEndpointType(value: unknown): value is CustomEndpointType {
  return typeof value === "string" && (ENDPOINT_TYPES as readonly string[]).includes(value)
}

/** Coerce one raw stored item to a typed endpoint, or null if it's malformed. */
function readStoredEndpoint(raw: unknown): (CustomEndpoint & { headers: string }) | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  if (typeof r.id !== "string" || !r.id) return null
  if (!isEndpointType(r.type)) return null
  return {
    id: r.id,
    name: typeof r.name === "string" ? r.name : "",
    type: r.type,
    baseUrl: typeof r.baseUrl === "string" ? r.baseUrl : "",
    model: typeof r.model === "string" ? r.model : "",
    // Stored encrypted; decrypt() is a no-op passthrough for already-plaintext values.
    headers: typeof r.headers === "string" && r.headers ? decrypt(r.headers) : "",
  }
}

/** Decrypt a raw `User.customEndpoints` JSON value into runtime endpoints. */
export function decryptUserEndpoints(raw: unknown): CustomEndpoint[] {
  if (!Array.isArray(raw)) return []
  const out: CustomEndpoint[] = []
  for (const item of raw) {
    const ep = readStoredEndpoint(item)
    if (ep) out.push(ep)
  }
  return out
}

/** Encrypt the `headers` of each endpoint for storage; other fields stay plaintext. */
export function encryptEndpointsForStorage(
  endpoints: CustomEndpoint[]
): Array<Record<string, unknown>> {
  return endpoints.map((e) => ({
    id: e.id,
    name: e.name,
    type: e.type,
    baseUrl: e.baseUrl,
    model: e.model,
    headers: e.headers ? encrypt(e.headers) : "",
  }))
}

/** Load + decrypt a user's custom endpoints. */
export async function getUserEndpoints(userId: string): Promise<CustomEndpoint[]> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { customEndpoints: true },
  })
  return decryptUserEndpoints(user?.customEndpoints)
}

export interface EndpointValidationError {
  message: string
}

/**
 * Validate an incoming endpoint list. Mirrors the client-side gate: each endpoint
 * needs a name and base URL; OpenCode additionally needs a model (it addresses
 * models as `<provider>/<model>`). Returns null when valid.
 */
export function validateEndpoints(
  endpoints: CustomEndpoint[]
): EndpointValidationError | null {
  const seen = new Set<string>()
  for (const e of endpoints) {
    if (!isEndpointType(e.type)) return { message: "Custom endpoint: invalid type." }
    const name = e.name?.trim()
    if (!name) return { message: "Custom endpoint: name is required." }
    if (!e.baseUrl?.trim()) return { message: `${name}: Base URL is required.` }
    if (e.type === "opencode" && !e.model?.trim()) {
      return { message: `${name}: Model is required for OpenCode endpoints.` }
    }
    if (seen.has(e.id)) return { message: "Custom endpoint: duplicate id." }
    seen.add(e.id)
  }
  return null
}

/**
 * Normalize an untrusted incoming `customEndpoints` body into typed endpoints,
 * trimming string fields. Throws nothing — unknown items are dropped.
 */
export function readIncomingEndpoints(raw: unknown): CustomEndpoint[] {
  if (!Array.isArray(raw)) return []
  const out: CustomEndpoint[] = []
  for (const item of raw) {
    if (!item || typeof item !== "object") continue
    const r = item as Record<string, unknown>
    if (typeof r.id !== "string" || !r.id) continue
    if (!isEndpointType(r.type)) continue
    out.push({
      id: r.id,
      name: typeof r.name === "string" ? r.name.trim() : "",
      type: r.type,
      baseUrl: typeof r.baseUrl === "string" ? r.baseUrl.trim() : "",
      model: typeof r.model === "string" ? r.model.trim() : "",
      headers: typeof r.headers === "string" ? r.headers : "",
    })
  }
  return out
}
