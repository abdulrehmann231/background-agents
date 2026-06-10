/**
 * Background Session Types
 */

import type { Event } from "../types/events"
import type { CumulativeUsage } from "./usage"

/**
 * Run phase for background sessions
 */
export type BackgroundRunPhase = "idle" | "starting" | "running" | "stopped"

/**
 * Handle returned when starting a turn
 */
export interface TurnHandle {
  executionId: string
  pid: number
  outputFile: string
}

/**
 * Result of polling for events
 */
export interface PollResult {
  sessionId: string | null
  events: Event[]
  cursor: string
  running: boolean
  runPhase: BackgroundRunPhase
}

/**
 * Session metadata stored in sandbox
 */
export interface SessionMeta {
  currentTurn: number
  cursor: number
  rawCursor?: number
  pid?: number
  runId?: string
  outputFile?: string
  sawEnd?: boolean
  startedAt?: string
  provider?: string
  sessionId?: string | null
  /**
   * Cumulative usage already attributed to prior turns, used as the baseline
   * for diffing the next turn's usage. Updated each time usage is computed.
   */
  usageCum?: CumulativeUsage
  /**
   * Usage delta for the most recently completed turn, plus the turn index it
   * belongs to. Cached so getTurnUsage() is idempotent per turn and so the
   * read-only snapshot path can surface usage without re-running tokscale.
   */
  lastTurnUsage?: { turn: number; usage: CumulativeUsage }
}

/**
 * A single message from previous conversation history.
 * Used to inject context when switching agents or forking chats.
 */
export interface HistoryMessage {
  readonly role: "user" | "assistant"
  readonly content: string
}

/**
 * Options for starting a turn
 */
export interface StartOptions {
  prompt: string
  model?: string
  sessionId?: string
  timeout?: number
  systemPrompt?: string
  env?: Record<string, string>
  /** Working directory for the agent process */
  cwd?: string
  /** Previous conversation history to inject as context for this turn. */
  history?: readonly HistoryMessage[]
  /** When true, agent should use extended thinking / plan mode */
  planMode?: boolean
}
