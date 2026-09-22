import {
  BarChart3,
  Key,
  Sun,
  Bot,
  Settings as SettingsIcon,
  GitBranch,
  FolderDown,
  Bell,
  CreditCard,
  Server,
  Wrench,
} from "lucide-react"

/** Settings page section identifier (also the URL segment: /settings/<key>). */
export type SectionKey =
  | "general"
  | "api-keys"
  | "custom-endpoints"
  | "credits"
  | "usage"
  | "git"
  | "notifications"
  | "local-sync"
  | "appearance"
  | "developer"

export type SectionDef = { key: SectionKey; label: string; icon: typeof Bot }

const baseSections: SectionDef[] = [
  { key: "general", label: "General", icon: SettingsIcon },
  { key: "api-keys", label: "API Keys", icon: Key },
  { key: "custom-endpoints", label: "Custom endpoints", icon: Server },
  { key: "credits", label: "Credits", icon: CreditCard },
  { key: "usage", label: "Usage", icon: BarChart3 },
  { key: "appearance", label: "Appearance", icon: Sun },
  { key: "git", label: "Git", icon: GitBranch },
  { key: "notifications", label: "Notifications", icon: Bell },
  { key: "developer", label: "Developer", icon: Wrench },
]

const localSyncSection: SectionDef = { key: "local-sync", label: "Local Sync", icon: FolderDown }

/** The "Local Sync" section is desktop-only; the web app never shows it. */
export function getSections(isDesktopApp: boolean): SectionDef[] {
  if (!isDesktopApp) return baseSections
  const out = [...baseSections]
  const gitIndex = out.findIndex((s) => s.key === "git")
  out.splice(gitIndex + 1, 0, localSyncSection)
  return out
}

const ALL_SECTION_KEYS: SectionKey[] = [...baseSections, localSyncSection].map((s) => s.key)

/**
 * Coerce an untrusted section id (e.g. the /settings/<section> URL segment)
 * into a real section, falling back to "general".
 */
export function normalizeSectionKey(section: string | null | undefined): SectionKey {
  return ALL_SECTION_KEYS.find((k) => k === section) ?? "general"
}
