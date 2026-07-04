/**
 * Unit tests for initialCredValues — the helper that decides which API-key
 * fields open pre-filled with the "***" mask (credential present) vs blank.
 *
 * Regression: OpenCode and Gemini expose a combined presence flag that is also
 * true when only the *server's* shared/env key exists. Masking off that flag
 * made a user's own key appear to "come back" after they cleared it, because the
 * shared env key kept the combined flag set. Only user-owned keys should mask.
 */
import { describe, it, expect } from "vitest"
import { initialCredValues, MASK } from "./shared"
import type { CredentialFlags } from "@/lib/credentials"

describe("initialCredValues", () => {
  it("masks a field the user has their own key for", () => {
    const flags: CredentialFlags = { ANTHROPIC_API_KEY: true }
    expect(initialCredValues(flags).ANTHROPIC_API_KEY).toBe(MASK)
  })

  it("leaves a field blank when the user has no key", () => {
    expect(initialCredValues({}).ANTHROPIC_API_KEY).toBe("")
  })

  it("does NOT mask OpenCode when only the server's shared key exists", () => {
    // Combined flag is true (env key), but the user owns nothing.
    const flags: CredentialFlags = {
      OPENCODE_API_KEY: true,
      OPENCODE_API_KEY_SHARED: true,
      OPENCODE_API_KEY_USER: false,
    }
    expect(initialCredValues(flags).OPENCODE_API_KEY).toBe("")
  })

  it("masks OpenCode when the user has their own stored key", () => {
    const flags: CredentialFlags = {
      OPENCODE_API_KEY: true,
      OPENCODE_API_KEY_USER: true,
    }
    expect(initialCredValues(flags).OPENCODE_API_KEY).toBe(MASK)
  })

  it("does NOT mask Gemini when only the server's shared key exists", () => {
    const flags: CredentialFlags = {
      GEMINI_API_KEY: true,
      GEMINI_API_KEY_SHARED: true,
      GEMINI_API_KEY_USER: false,
    }
    expect(initialCredValues(flags).GEMINI_API_KEY).toBe("")
  })

  it("masks Gemini when the user has their own stored key", () => {
    const flags: CredentialFlags = {
      GEMINI_API_KEY: true,
      GEMINI_API_KEY_USER: true,
    }
    expect(initialCredValues(flags).GEMINI_API_KEY).toBe(MASK)
  })

  it("clearing a user key while a shared key remains reopens blank", () => {
    // Before: user had their own OpenCode key → field masked.
    const withUserKey: CredentialFlags = {
      OPENCODE_API_KEY: true,
      OPENCODE_API_KEY_SHARED: true,
      OPENCODE_API_KEY_USER: true,
    }
    expect(initialCredValues(withUserKey).OPENCODE_API_KEY).toBe(MASK)

    // After clearing + save: server drops the user key; only the shared/env key
    // remains, so the flags come back with USER=false. The field must reopen
    // blank rather than re-masking from the shared key.
    const afterClear: CredentialFlags = {
      OPENCODE_API_KEY: true,
      OPENCODE_API_KEY_SHARED: true,
      OPENCODE_API_KEY_USER: false,
    }
    expect(initialCredValues(afterClear).OPENCODE_API_KEY).toBe("")
  })
})
