/**
 * Common utility functions shared across packages
 */

import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

// Shell escaping helpers live in the lower-level SDK package; re-export them
// here so consumers of @background-agents/common have a single import surface.
// Import from the leaf module (not the package barrel) so that pulling in
// `cn` from this file does not drag the SDK's Node-only modules
// (e.g. node:child_process) into client/browser bundles.
export { escapeShell, quote } from "@background-agents/sdk/utils/shell"

/**
 * Merge Tailwind CSS classes with proper precedence handling
 * Combines clsx for conditional classes with tailwind-merge for deduplication
 *
 * @example
 * cn("px-2 py-1", "px-4") // => "py-1 px-4"
 * cn("text-red-500", isActive && "text-blue-500") // conditional
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
