/**
 * Background module exports
 */

export type {
  BackgroundRunPhase,
  HistoryMessage,
  PollResult,
  SessionMeta,
  StartOptions,
  TurnHandle,
} from "./types"

export {
  createBackgroundSession,
  writeInitialSessionMeta,
  readProviderFromMeta,
  type BackgroundSession,
} from "./session"

export {
  isTurnStalled,
  resolveStallTimeoutMs,
  DEFAULT_STALL_TIMEOUT_MS,
  STALL_ERROR_MESSAGE,
  type StallCheck,
} from "./stall"
