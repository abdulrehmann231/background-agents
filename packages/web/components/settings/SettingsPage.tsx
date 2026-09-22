"use client"

import { useState, useEffect, useMemo, useRef, useCallback } from "react"
import { useTheme } from "next-themes"
import { ArrowLeft } from "lucide-react"
import { cn } from "@/lib/utils"
import { useElectron, type LicenseDetectResult } from "@/lib/hooks/useElectron"
import { ROUTES } from "@/lib/hooks/useUrlNavigation"
import { useSettingsQuery } from "@/lib/query/hooks/useSettingsQuery"
import { CREDENTIAL_KEYS, type CredentialId } from "@/lib/credentials"
import type { Settings, Theme, Agent, Credentials, CredentialFlags, CustomEndpoint } from "@/lib/types"
import { agentModels, resolveAgent, getDefaultModelForAgent } from "@/lib/types"
import { GeneralSection } from "./GeneralSection"
import { ApiKeysSection, type HighlightKey } from "./ApiKeysSection"
import { CustomEndpointsSection } from "./CustomEndpointsSection"
import { CreditsSection } from "./CreditsSection"
import { GitSection } from "./GitSection"
import { NotificationsSection } from "./NotificationsSection"
import { LocalSyncSection } from "./LocalSyncSection"
import { AppearanceSection } from "./AppearanceSection"
import { DeveloperSection } from "./DeveloperSection"
import { initialCredValues, MASK } from "./shared"
import { getSections, type SectionDef, type SectionKey } from "./sections"

export interface SaveSettingsData {
  settings?: Partial<Settings>
  credentials?: Credentials
  customEndpoints?: CustomEndpoint[]
}

interface SettingsPageProps {
  isMobile: boolean
  /** Section shown on desktop. Mobile stacks every section in one scroll. */
  activeSection: SectionKey
  onSectionChange: (section: SectionKey) => void
  onSave: (data: SaveSettingsData) => Promise<{ ok: boolean; error?: string }>
  /** Leave Settings. Pending edits are persisted as the page unmounts. */
  onClose: () => void
  /** Which provider's first API key field to highlight with a red outline */
  highlightKey?: HighlightKey
  /** Called if the user leaves without providing the highlighted key. */
  onDismissWithoutKey?: (() => void) | null
}

/**
 * The Settings page — a full view (not a dialog) living at /settings/<section>.
 *
 * Desktop gets a section rail beside the content; mobile drops the rail and
 * stacks every section in one scroll, each under its own heading.
 *
 * There is no Save button: leaving the page is what commits the edits (see the
 * unmount commit in SettingsForm).
 */
export function SettingsPage({
  isMobile,
  activeSection,
  onSectionChange,
  onSave,
  onClose,
  highlightKey,
  onDismissWithoutKey,
}: SettingsPageProps) {
  const { isDesktopApp } = useElectron()
  const { data, isPlaceholderData } = useSettingsQuery()

  // The "Local Sync" section only exists in the desktop app.
  const sections = useMemo(() => getSections(isDesktopApp), [isDesktopApp])

  // Switching sections is a lateral move, not a new destination: replace the
  // history entry so Back leaves Settings instead of retracing visited sections.
  const selectSection = useCallback(
    (section: SectionKey) => {
      onSectionChange(section)
      window.history.replaceState(null, "", ROUTES.settings.build(section))
    },
    [onSectionChange]
  )

  const activeTitle = sections.find((s) => s.key === activeSection)?.label ?? "Settings"

  return (
    // min-w-0 matters: as a direct flex child of the window row, without it the
    // page floors at its content's intrinsic width and overflows on phones.
    <div className="flex flex-1 flex-col bg-background min-h-0 min-w-0">
      {/* Page header — the only way back out on mobile, where there is no sidebar. */}
      <header
        className={cn(
          "flex flex-shrink-0 items-center gap-1 border-b border-sidebar-border px-2 sm:px-3",
          isMobile ? "pt-safe pb-2" : "py-2"
        )}
      >
        <button
          onClick={onClose}
          aria-label="Back"
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground cursor-pointer touch-target"
        >
          <ArrowLeft className="h-[18px] w-[18px]" />
        </button>
        <h1 className={cn("font-medium", isMobile ? "text-base" : "text-sm")}>Settings</h1>
      </header>

      <div className="flex min-h-0 flex-1">
        {!isMobile && (
          // Same surface and hairline as the chat sidebar: the app separates
          // columns with a border, never with a different background tint.
          <nav
            aria-label="Settings sections"
            className="flex w-44 flex-shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-sidebar-border bg-background p-2 lg:w-52"
          >
            {sections.map((s) => {
              const Icon = s.icon
              const isActive = activeSection === s.key
              return (
                <button
                  key={s.key}
                  onClick={() => selectSection(s.key)}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors cursor-pointer",
                    isActive
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                  )}
                >
                  <Icon className="h-4 w-4 flex-shrink-0" />
                  <span className="truncate">{s.label}</span>
                </button>
              )
            })}
          </nav>
        )}

        <div className={cn("min-w-0 flex-1 overflow-y-auto", isMobile && "mobile-scroll")}>
          {/* Capped and centred in the pane beside the rail. The cap keeps a
              control from ending up a screen-width away from its label. */}
          <div
            className={cn(
              "w-full",
              isMobile ? "px-4 pt-4 pb-16" : "mx-auto max-w-3xl px-8 pt-6 pb-12"
            )}
          >
            {!isMobile && (
              <h2 className="mb-1 text-base font-medium">{activeTitle}</h2>
            )}
            {isPlaceholderData || !data ? (
              <SettingsSkeleton />
            ) : (
              <SettingsForm
                isMobile={isMobile}
                sections={sections}
                activeSection={activeSection}
                settings={data.settings}
                credentialFlags={data.credentialFlags}
                initialEndpoints={data.customEndpoints ?? []}
                onSave={onSave}
                highlightKey={highlightKey}
                onDismissWithoutKey={onDismissWithoutKey}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/** Placeholder rows shown until the settings query returns real data. */
function SettingsSkeleton() {
  return (
    <div className="space-y-3" aria-hidden>
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center justify-between gap-4 py-3">
          <div className="h-4 w-32 animate-pulse rounded bg-muted" />
          <div className="h-8 w-44 animate-pulse rounded bg-muted" />
        </div>
      ))}
    </div>
  )
}

interface SettingsFormProps {
  isMobile: boolean
  sections: SectionDef[]
  activeSection: SectionKey
  settings: Settings
  credentialFlags: CredentialFlags
  initialEndpoints: CustomEndpoint[]
  onSave: (data: SaveSettingsData) => Promise<{ ok: boolean; error?: string }>
  highlightKey?: HighlightKey
  onDismissWithoutKey?: (() => void) | null
}

/**
 * The editable form. Mounted only once the settings query has real data, so
 * every field can seed itself from props on the first render.
 */
function SettingsForm({
  isMobile,
  sections,
  activeSection,
  settings,
  credentialFlags,
  initialEndpoints,
  onSave,
  highlightKey,
  onDismissWithoutKey,
}: SettingsFormProps) {
  const { setTheme } = useTheme()
  const {
    isDesktopApp,
    getClaudeLicenseAutoDetect,
    getLicenseDetectSettings,
    setLicenseDetectSettings,
  } = useElectron()

  // The values Settings opened with — the baseline every pending change is
  // diffed against on the way out. Snapshotted once: the settings query hands
  // back fresh objects on every refetch (it refetches on window focus, and
  // connecting a ChatGPT subscription invalidates it), and letting that shift
  // the baseline mid-edit would silently drop or resurrect changes.
  const [initial] = useState(() => {
    // Resolve a null preference against the saved credential flags so the
    // dropdown shows whatever new chats would actually use.
    const agent = resolveAgent(settings.defaultAgent, undefined)
    return {
      settings,
      endpoints: initialEndpoints,
      creds: initialCredValues(credentialFlags),
      agent,
      model: settings.defaultModel ?? getDefaultModelForAgent(agent, credentialFlags),
    }
  })

  // Refs for API key inputs, keyed by credential id.
  const inputRefs = useRef<Partial<Record<CredentialId, HTMLInputElement | HTMLTextAreaElement | null>>>({})
  const setInputRef = useCallback(
    (id: CredentialId) => (el: HTMLInputElement | HTMLTextAreaElement | null) => {
      inputRefs.current[id] = el
    },
    []
  )

  // Form state
  const [credValues, setCredValues] = useState<Record<CredentialId, string>>(initial.creds)
  // Working copy of the custom-endpoint list, edited in the Custom endpoints tab.
  const [endpoints, setEndpoints] = useState<CustomEndpoint[]>(initial.endpoints)
  const [defaultAgent, setDefaultAgent] = useState<Agent>(initial.agent)
  const [defaultModel, setDefaultModel] = useState(initial.model)
  const [selectedTheme, setSelectedTheme] = useState<Theme>(initial.settings.theme)
  const [enablePrepushHooks, setEnablePrepushHooks] = useState(initial.settings.enablePrepushHooks)
  const [notifyOnAgentFinished, setNotifyOnAgentFinished] = useState(initial.settings.notifyOnAgentFinished)
  const [notifyOnAgentCommitted, setNotifyOnAgentCommitted] = useState(initial.settings.notifyOnAgentCommitted)
  const [notificationSound, setNotificationSound] = useState(initial.settings.notificationSound)
  const [elizaEnabled, setElizaEnabled] = useState(initial.settings.elizaEnabled)

  // License auto-detect state (desktop only)
  const [licenseAutoDetectEnabled, setLicenseAutoDetectEnabled] = useState(true)
  const [licenseDetectResult, setLicenseDetectResult] = useState<LicenseDetectResult | null>(null)
  const [licenseDetectLoading, setLicenseDetectLoading] = useState(false)

  // Flags reflecting the current form state — a typed value or "***" mask both
  // count as "credential present" for model availability checks. We start from
  // the live server flags so shared-pool availability (Claude shared pool,
  // OpenCode / Gemini env keys) is preserved, then overlay the user's edits.
  // OpenCode and Gemini keep their combined flag available via the server's
  // shared flag even after the user's own key is cleared.
  const liveFlags = useMemo<CredentialFlags>(() => {
    const out: CredentialFlags = { ...credentialFlags }
    for (const { id } of CREDENTIAL_KEYS) {
      const typed = !!credValues[id]
      if (id === "OPENCODE_API_KEY") {
        out.OPENCODE_API_KEY_USER = typed
        out.OPENCODE_API_KEY = typed || !!credentialFlags.OPENCODE_API_KEY_SHARED
      } else if (id === "GEMINI_API_KEY") {
        out.GEMINI_API_KEY_USER = typed
        out.GEMINI_API_KEY = typed || !!credentialFlags.GEMINI_API_KEY_SHARED
      } else {
        out[id] = typed
      }
    }
    return out
  }, [credValues, credentialFlags])

  // Refresh license detection
  const refreshLicenseDetect = useCallback(async () => {
    if (!isDesktopApp) return
    setLicenseDetectLoading(true)
    try {
      const result = await getClaudeLicenseAutoDetect()
      setLicenseDetectResult(result)
    } finally {
      setLicenseDetectLoading(false)
    }
  }, [isDesktopApp, getClaudeLicenseAutoDetect])

  // Load license auto-detect settings and check for credentials (desktop only)
  useEffect(() => {
    if (!isDesktopApp) return
    getLicenseDetectSettings().then((s) => {
      if (s) setLicenseAutoDetectEnabled(s.autoDetectEnabled)
    })
    refreshLicenseDetect()
  }, [isDesktopApp, getLicenseDetectSettings, refreshLicenseDetect])

  // Handle auto-detect toggle change
  const handleAutoDetectToggle = useCallback(async (enabled: boolean) => {
    setLicenseAutoDetectEnabled(enabled)
    await setLicenseDetectSettings({ autoDetectEnabled: enabled })
    // Refresh detection when enabling
    if (enabled) refreshLicenseDetect()
  }, [setLicenseDetectSettings, refreshLicenseDetect])

  // Focus the highlighted API key field once it is on screen.
  useEffect(() => {
    if (!highlightKey) return
    const target = CREDENTIAL_KEYS.find((c) => c.provider === highlightKey)
    if (!target) return
    const timer = setTimeout(() => {
      const el = inputRefs.current[target.id]
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" })
        el.focus()
      }
    }, 100)
    return () => clearTimeout(timer)
  }, [highlightKey])

  // Update model when agent changes
  useEffect(() => {
    const models = agentModels[defaultAgent] ?? []
    // If current model isn't valid for the new agent, select the first available
    const isValidModel = models.some((m) => m.value === defaultModel)
    if (!isValidModel && models.length > 0) {
      setDefaultModel(models[0].value)
    }
  }, [defaultAgent, defaultModel])

  // Apply theme immediately when changed
  const handleThemeChange = (theme: Theme) => {
    setSelectedTheme(theme)
    setTheme(theme)
  }

  const endpointsChanged = useMemo(
    () => JSON.stringify(endpoints) !== JSON.stringify(initial.endpoints),
    [endpoints, initial.endpoints]
  )

  // Collect all pending changes into a single save payload, or null if nothing
  // changed. There is no explicit Save button — settings persist automatically
  // when the page is left (see the unmount commit below).
  const buildSaveData = useCallback((): SaveSettingsData | null => {
    const base = initial.settings
    const settingsPatch: Partial<Settings> = {}
    if (defaultAgent !== initial.agent) settingsPatch.defaultAgent = defaultAgent
    if (defaultModel !== initial.model) settingsPatch.defaultModel = defaultModel
    if (selectedTheme !== base.theme) settingsPatch.theme = selectedTheme
    if (enablePrepushHooks !== base.enablePrepushHooks) settingsPatch.enablePrepushHooks = enablePrepushHooks
    if (notifyOnAgentFinished !== base.notifyOnAgentFinished) settingsPatch.notifyOnAgentFinished = notifyOnAgentFinished
    if (notifyOnAgentCommitted !== base.notifyOnAgentCommitted) settingsPatch.notifyOnAgentCommitted = notifyOnAgentCommitted
    if (notificationSound !== base.notificationSound) settingsPatch.notificationSound = notificationSound
    if (elizaEnabled !== base.elizaEnabled) settingsPatch.elizaEnabled = elizaEnabled

    // Only send credential fields the user actually changed. Sending the
    // mask back ("***") would otherwise overwrite the real key.
    const credentialsPatch: Credentials = {}
    for (const { id } of CREDENTIAL_KEYS) {
      const next = credValues[id]
      if (next === initial.creds[id]) continue
      if (next === MASK) continue
      credentialsPatch[id] = next
    }

    // If auto-detect is enabled and credentials were found, include them
    if (isDesktopApp && licenseAutoDetectEnabled && licenseDetectResult?.found && licenseDetectResult.credentials) {
      // Only include if user hasn't manually entered a different value.
      // Treat an explicit empty string as a CLEAR request and do NOT override it.
      const manualValue = credValues["CLAUDE_CODE_CREDENTIALS"]
      if (
        manualValue === MASK ||
        manualValue === initial.creds["CLAUDE_CODE_CREDENTIALS"]
      ) {
        credentialsPatch["CLAUDE_CODE_CREDENTIALS"] = licenseDetectResult.credentials
      }
    }

    const data: SaveSettingsData = {}
    if (Object.keys(settingsPatch).length > 0) data.settings = settingsPatch
    if (Object.keys(credentialsPatch).length > 0) data.credentials = credentialsPatch
    // Persist endpoints only when they're all valid (name + base URL always,
    // plus a model for OpenCode). A half-finished endpoint is simply not saved.
    const badEndpoint = endpoints.find(
      (e) => !e.name.trim() || !e.baseUrl.trim() || (e.type === "opencode" && !e.model.trim())
    )
    if (endpointsChanged && !badEndpoint) data.customEndpoints = endpoints

    return Object.keys(data).length > 0 ? data : null
  }, [
    initial, defaultAgent, defaultModel, selectedTheme, enablePrepushHooks,
    notifyOnAgentFinished, notifyOnAgentCommitted, notificationSound, elizaEnabled,
    credValues, isDesktopApp, licenseAutoDetectEnabled, licenseDetectResult,
    endpoints, endpointsChanged,
  ])

  // Persist pending changes (fire-and-forget) on the way out. Leaving the page
  // is what commits the edits, whichever way the user leaves: the Back button,
  // a sidebar click, or browser back — they all unmount this form.
  const commitRef = useRef<() => void>(() => {})
  commitRef.current = () => {
    const data = buildSaveData()
    if (data) void onSave(data)
    // If Settings was opened to collect a required API key (highlightKey) and
    // the user left without entering one, run the revert callback (e.g.
    // restore the previously-selected agent that didn't need a key).
    if (highlightKey && onDismissWithoutKey) {
      const target = CREDENTIAL_KEYS.find((c) => c.provider === highlightKey)
      const entered = target ? credValues[target.id] : undefined
      if (!entered || entered === MASK) onDismissWithoutKey()
    }
  }

  useEffect(() => {
    // The timer marks this mount as real: React's development-only double
    // invocation runs the cleanup synchronously right after mount, and that
    // pass must not commit (it would fire the revert callback immediately).
    let mounted = false
    const timer = setTimeout(() => { mounted = true }, 0)
    return () => {
      clearTimeout(timer)
      if (mounted) commitRef.current()
    }
  }, [])

  const setCredValue = useCallback((id: CredentialId, value: string) => {
    setCredValues((prev) => ({ ...prev, [id]: value }))
  }, [])

  // Section renderers — kept inline so the form state stays in this component.
  const renderSection = (key: SectionKey) => {
    switch (key) {
      case "general":
        return (
          <GeneralSection
            isMobile={isMobile}
            defaultAgent={defaultAgent}
            setDefaultAgent={setDefaultAgent}
            defaultModel={defaultModel}
            setDefaultModel={setDefaultModel}
            liveFlags={liveFlags}
            elizaEnabled={elizaEnabled}
          />
        )
      case "api-keys":
        return (
          <ApiKeysSection
            isMobile={isMobile}
            credValues={credValues}
            setCredValue={setCredValue}
            highlightKey={highlightKey}
            setInputRef={setInputRef}
            isDesktopApp={isDesktopApp}
            licenseAutoDetectEnabled={licenseAutoDetectEnabled}
            onAutoDetectToggle={handleAutoDetectToggle}
            refreshLicenseDetect={refreshLicenseDetect}
            licenseDetectLoading={licenseDetectLoading}
            licenseDetectResult={licenseDetectResult}
          />
        )
      case "custom-endpoints":
        return (
          <CustomEndpointsSection
            isMobile={isMobile}
            endpoints={endpoints}
            setEndpoints={setEndpoints}
          />
        )
      case "credits":
        return <CreditsSection isMobile={isMobile} />
      case "git":
        return (
          <GitSection
            isMobile={isMobile}
            enablePrepushHooks={enablePrepushHooks}
            setEnablePrepushHooks={setEnablePrepushHooks}
          />
        )
      case "notifications":
        return (
          <NotificationsSection
            isMobile={isMobile}
            notifyOnAgentFinished={notifyOnAgentFinished}
            setNotifyOnAgentFinished={setNotifyOnAgentFinished}
            notifyOnAgentCommitted={notifyOnAgentCommitted}
            setNotifyOnAgentCommitted={setNotifyOnAgentCommitted}
            notificationSound={notificationSound}
            setNotificationSound={setNotificationSound}
          />
        )
      case "local-sync":
        return <LocalSyncSection isMobile={isMobile} />
      case "appearance":
        return (
          <AppearanceSection
            isMobile={isMobile}
            selectedTheme={selectedTheme}
            onThemeChange={handleThemeChange}
          />
        )
      case "developer":
        return (
          <DeveloperSection
            isMobile={isMobile}
            elizaEnabled={elizaEnabled}
            setElizaEnabled={setElizaEnabled}
          />
        )
    }
  }

  // Mobile has no section rail, so every section is laid out in one scroll.
  if (isMobile) {
    return (
      <div className="space-y-8">
        {sections.map((s) => (
          <div key={s.key}>{renderSection(s.key)}</div>
        ))}
      </div>
    )
  }

  return <>{renderSection(activeSection)}</>
}
