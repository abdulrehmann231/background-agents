/**
 * Constants for Simple Chat
 * Re-exports shared constants from @background-agents/common
 */

import { PATHS as COMMON_PATHS, SANDBOX_CONFIG as COMMON_SANDBOX_CONFIG } from "@background-agents/common"

// Re-export PATHS directly (same values)
export const PATHS = COMMON_PATHS

// Override SANDBOX_CONFIG with simple-chat specific label
export const SANDBOX_CONFIG = {
  ...COMMON_SANDBOX_CONFIG,
  /** Label key for identifying simple-chat sandboxes */
  LABEL_KEY: "simple-chat",
} as const

// The docs site is deployed separately (packages/docs) at its own domain.
export const DOCS_URL = process.env.NEXT_PUBLIC_DOCS_URL || "https://docs.backgrounder.dev"
