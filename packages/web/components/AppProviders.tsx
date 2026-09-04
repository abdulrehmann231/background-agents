"use client"

import type { ReactNode } from "react"
import { PaletteProvider } from "@/components/search-palette"
import { ChatProvider, GitProvider, type ChatContextValue, type GitContextValue } from "@/lib/contexts"

interface AppProvidersProps {
  paletteProps: Omit<React.ComponentProps<typeof PaletteProvider>, "children">
  chatContextValue: ChatContextValue
  gitContextValue: GitContextValue
  children: ReactNode
}

export function AppProviders({
  paletteProps,
  chatContextValue,
  gitContextValue,
  children,
}: AppProvidersProps) {
  return (
    <PaletteProvider {...paletteProps}>
      <ChatProvider value={chatContextValue}>
        <GitProvider value={gitContextValue}>
          {children}
        </GitProvider>
      </ChatProvider>
    </PaletteProvider>
  )
}
