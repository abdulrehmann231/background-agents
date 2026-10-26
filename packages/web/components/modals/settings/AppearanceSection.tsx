"use client"

import { Sun, Moon, Monitor } from "lucide-react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { Theme } from "@/lib/types"
import { SettingsRow, ToggleSwitch, MobileSectionHeader } from "./shared"

const themeOptions: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "system", label: "Auto", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
]

interface AppearanceSectionProps {
  isMobile: boolean
  selectedTheme: Theme
  onThemeChange: (theme: Theme) => void
  showCommandPaletteButton: boolean
  setShowCommandPaletteButton: (next: boolean) => void
}

/** Appearance settings: theme picker (auto/light/dark) and chat-header toggles. */
export function AppearanceSection({
  isMobile,
  selectedTheme,
  onThemeChange,
  showCommandPaletteButton,
  setShowCommandPaletteButton,
}: AppearanceSectionProps) {
  return (
    <div>
      {isMobile && <MobileSectionHeader icon={Sun} label="Appearance" />}
      <SettingsRow label="Theme">
        <Select value={selectedTheme} onValueChange={(v) => onThemeChange(v as Theme)}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Select theme" />
          </SelectTrigger>
          <SelectContent>
            {themeOptions.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingsRow>
      <SettingsRow
        label="Command palette button"
        description="Show a button for the command palette (⌘K). The shortcut always works, button or not."
      >
        <ToggleSwitch checked={showCommandPaletteButton} onChange={setShowCommandPaletteButton} />
      </SettingsRow>
    </div>
  )
}
