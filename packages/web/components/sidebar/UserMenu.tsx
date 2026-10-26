"use client"

import { useState, useRef } from "react"
import { signOut } from "next-auth/react"
import { Settings, LogOut, HelpCircle, BarChart3, BookOpen } from "lucide-react"
import { cn } from "@/lib/utils"
import { clearAllStorage } from "@/lib/storage"
import { useClickOutside } from "@/lib/hooks/useClickOutside"
import { useModals } from "@/lib/contexts"
import { DOCS_URL } from "@/lib/constants"

interface UserMenuProps {
  user: {
    name?: string | null
    email?: string | null
    image?: string | null
    isAdmin?: boolean
  }
  collapsed: boolean
  /** "mobile" renders the drawer's larger touch targets and ignores `collapsed`
   *  (the drawer's sidebar is never shown collapsed). Defaults to "desktop". */
  variant?: "desktop" | "mobile"
}

export function UserMenu({ user, collapsed, variant = "desktop" }: UserMenuProps) {
  const modals = useModals()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const isMobile = variant === "mobile"

  useClickOutside(menuRef, () => setMenuOpen(false), menuOpen)

  const avatarSize = isMobile ? "h-10 w-10" : "h-8 w-8"
  const avatar = user.image ? (
    <img
      src={user.image}
      alt={user.name || "User"}
      className={cn(avatarSize, "flex-shrink-0 rounded-full")}
    />
  ) : (
    <div className={cn(avatarSize, "flex-shrink-0 rounded-full bg-muted flex items-center justify-center text-xs")}>
      {user.name?.[0] || "?"}
    </div>
  )

  // Shared styling for the four popup menu items below.
  const itemClass = isMobile
    ? "flex items-center gap-3 w-full px-4 py-3 text-base hover:bg-accent active:bg-accent cursor-pointer"
    : "flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-accent cursor-pointer"
  const iconClass = isMobile ? "h-5 w-5" : "h-4 w-4"

  return (
    <div className={cn("relative", collapsed && !isMobile ? "flex justify-center" : "")} ref={menuRef}>
      <button
        onClick={() => setMenuOpen((v) => !v)}
        className={
          isMobile
            ? "flex items-center gap-3 w-full rounded-lg hover:bg-accent active:bg-accent transition-colors p-2 -m-2"
            : cn(
                "flex items-center gap-2 cursor-pointer rounded-md transition-colors",
                collapsed ? "p-1.5" : "w-full min-w-0 px-2 py-1.5 hover:bg-accent text-left"
              )
        }
        aria-haspopup="menu"
        aria-expanded={menuOpen}
      >
        {avatar}
        {(!collapsed || isMobile) && (
          <div className="flex-1 min-w-0 text-left">
            <div className={cn("font-medium truncate", isMobile ? "text-base" : "text-sm")}>{user.name}</div>
            <div className={cn("text-muted-foreground truncate", isMobile ? "text-sm" : "text-xs")}>{user.email}</div>
          </div>
        )}
      </button>

      {menuOpen && (
        <div
          className={cn(
            "absolute bottom-full rounded-md border border-border bg-popover shadow-md py-1 z-50",
            isMobile ? "left-0 right-0 mb-2" : "mb-2 w-44",
            !isMobile && (collapsed ? "left-0" : "left-0 right-0 w-auto")
          )}
          role="menu"
        >
          {user.isAdmin && (
            <a
              href="/admin"
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setMenuOpen(false)}
              className={itemClass}
            >
              <BarChart3 className={iconClass} />
              Admin Dashboard
            </a>
          )}
          <button
            onClick={() => {
              modals.openSettings()
              setMenuOpen(false)
            }}
            className={itemClass}
          >
            <Settings className={iconClass} />
            Settings
          </button>
          <button
            onClick={() => {
              modals.setHelpOpen(true)
              setMenuOpen(false)
            }}
            className={itemClass}
          >
            <HelpCircle className={iconClass} />
            Help
          </button>
          <a
            href={DOCS_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setMenuOpen(false)}
            className={itemClass}
          >
            <BookOpen className={iconClass} />
            Docs
          </a>
          <button
            onClick={() => {
              clearAllStorage()
              signOut()
            }}
            className={itemClass}
          >
            <LogOut className={iconClass} />
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}
