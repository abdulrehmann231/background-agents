/**
 * Browser-safe Pi identity shared by the reasoning-effort levels and invocation.
 * Backgrounder's Anthropic picker historically stores bare claude-* IDs, while
 * Pi's exact-model registry takes provider + ID. Unknown/custom patterns are
 * passed through unchanged.
 */
export function piModelIdentity(model: string | undefined): string | undefined {
  if (!model) return undefined
  if (/^(?:anthropic|openai|google)\/[a-zA-Z0-9._-]+$/.test(model)) return model
  if (/^claude-[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(model)) return `anthropic/${model}`
  return undefined
}
