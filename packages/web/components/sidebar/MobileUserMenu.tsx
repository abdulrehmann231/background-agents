"use client"

import { BarChart3, Settings, HelpCircle, LogOut } from "lucide-react"
import { signOut } from "next-auth/react"
import { signInWithGitHub } from "@/lib/auth-utils"
import { clearAllStorage } from "@/lib/storage"
import type { Session } from "next-auth"

interface MobileUserMenuProps {
  session: Session | null
  isSessionLoading: boolean
  mobileUserMenuOpen: boolean
  setMobileUserMenuOpen: (v: boolean | ((prev: boolean) => boolean)) => void
  mobileUserMenuRef: React.RefObject<HTMLDivElement | null>
  modals: { openSettings: () => void; setHelpOpen: (v: boolean) => void }
}

export function MobileUserMenu({
  session,
  isSessionLoading,
  mobileUserMenuOpen,
  setMobileUserMenuOpen,
  mobileUserMenuRef,
  modals,
}: MobileUserMenuProps) {
  if (isSessionLoading) {
    return (
      <div className="p-4 pb-safe border-t border-sidebar-border">
        <div className="flex items-center gap-3 animate-pulse">
          <div className="h-10 w-10 rounded-full bg-muted flex-shrink-0" />
          <div className="flex-1 min-w-0 space-y-2">
            <div className="h-4 w-24 rounded bg-muted" />
            <div className="h-3 w-32 rounded bg-muted" />
          </div>
        </div>
      </div>
    )
  }

  if (session?.user) {
    return (
      <div className="p-4 pb-safe border-t border-sidebar-border">
        <div className="relative" ref={mobileUserMenuRef}>
          <button
            onClick={() => setMobileUserMenuOpen((v: boolean) => !v)}
            className="flex items-center gap-3 w-full rounded-lg hover:bg-accent active:bg-accent transition-colors p-2 -m-2"
          >
            {session.user.image && (
              <img
                src={session.user.image}
                alt={session.user.name || "User"}
                className="h-10 w-10 rounded-full"
              />
            )}
            <div className="flex-1 min-w-0 text-left">
              <div className="text-base font-medium truncate">
                {session.user.name}
              </div>
              <div className="text-sm text-muted-foreground truncate">
                {session.user.email}
              </div>
            </div>
          </button>

          {mobileUserMenuOpen && (
            <div className="absolute bottom-full left-0 right-0 mb-2 rounded-md border border-border bg-popover shadow-md py-1 z-50">
              {session.user.isAdmin && (
                <a
                  href="/admin"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setMobileUserMenuOpen(false)}
                  className="flex items-center gap-3 w-full px-4 py-3 text-base hover:bg-accent active:bg-accent cursor-pointer"
                >
                  <BarChart3 className="h-5 w-5" />
                  Admin Dashboard
                </a>
              )}
              <button
                onClick={() => {
                  modals.openSettings()
                  setMobileUserMenuOpen(false)
                }}
                className="flex items-center gap-3 w-full px-4 py-3 text-base hover:bg-accent active:bg-accent cursor-pointer"
              >
                <Settings className="h-5 w-5" />
                Settings
              </button>
              <button
                onClick={() => {
                  modals.setHelpOpen(true)
                  setMobileUserMenuOpen(false)
                }}
                className="flex items-center gap-3 w-full px-4 py-3 text-base hover:bg-accent active:bg-accent cursor-pointer"
              >
                <HelpCircle className="h-5 w-5" />
                Help
              </button>
              <button
                onClick={() => {
                  clearAllStorage()
                  signOut()
                }}
                className="flex items-center gap-3 w-full px-4 py-3 text-base hover:bg-accent active:bg-accent cursor-pointer"
              >
                <LogOut className="h-5 w-5" />
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 pb-safe border-t border-sidebar-border">
      <button
        onClick={() => signInWithGitHub()}
        className="flex items-center justify-center gap-2 w-full rounded-lg bg-secondary text-secondary-foreground hover:bg-secondary/80 active:bg-secondary/70 transition-colors px-4 py-3 touch-target"
      >
        <span className="text-base">Sign in with GitHub</span>
      </button>
    </div>
  )
}
