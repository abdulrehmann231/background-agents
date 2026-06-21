/**
 * Sandbox resource scaling bounds and helpers.
 *
 * Backs the "Sandbox resources" feature (resize CPU / RAM / disk after a
 * sandbox is created). Shared by the API route (server-side validation) and the
 * modal (slider bounds) so both agree on the allowed ranges.
 *
 * Ranges come from issue #230:
 *   - CPU:  1–5 vCPU
 *   - RAM:  1–5 GiB
 *   - Disk: 5–20 GiB
 *
 * Daytona constraints worth knowing (enforced by the SDK, surfaced as errors):
 *   - CPU/RAM hot-resize a running sandbox, but can only be INCREASED.
 *   - Disk can only be increased and requires the sandbox to be STOPPED.
 */

export const SANDBOX_RESOURCE_BOUNDS = {
  cpu: { min: 1, max: 5, step: 1, unit: "vCPU", label: "CPU" },
  memory: { min: 1, max: 5, step: 1, unit: "GiB", label: "RAM" },
  disk: { min: 5, max: 20, step: 1, unit: "GiB", label: "Disk" },
} as const

export type SandboxResourceKey = keyof typeof SANDBOX_RESOURCE_BOUNDS

export interface SandboxResources {
  cpu: number
  memory: number
  disk: number
}

/** Clamp a value to a resource's [min, max] and round to an integer. */
export function clampResource(key: SandboxResourceKey, value: number): number {
  const { min, max } = SANDBOX_RESOURCE_BOUNDS[key]
  return Math.min(max, Math.max(min, Math.round(value)))
}

/**
 * Validate a requested resize against the bounds. Returns an error string if
 * any provided field is out of range, otherwise null. Fields may be omitted —
 * only the ones present are validated (a partial resize is allowed).
 */
export function validateResources(
  req: Partial<SandboxResources>
): string | null {
  for (const key of Object.keys(SANDBOX_RESOURCE_BOUNDS) as SandboxResourceKey[]) {
    const value = req[key]
    if (value == null) continue
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return `${SANDBOX_RESOURCE_BOUNDS[key].label} must be a number`
    }
    const { min, max } = SANDBOX_RESOURCE_BOUNDS[key]
    if (value < min || value > max) {
      return `${SANDBOX_RESOURCE_BOUNDS[key].label} must be between ${min} and ${max}`
    }
  }
  return null
}
