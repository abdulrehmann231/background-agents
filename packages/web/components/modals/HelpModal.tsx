"use client"

import { useState, useEffect } from "react"
import * as Dialog from "@radix-ui/react-dialog"
import { HelpCircle, ChevronLeft, ChevronRight, Keyboard } from "lucide-react"
import { cn } from "@/lib/utils"
import { ModalHeader, focusChatPrompt } from "@/components/ui/modal-header"

interface HelpModalProps {
  open: boolean
  onClose: () => void
  isMobile?: boolean
}

type HelpPage = "home" | "shortcuts"

export function HelpModal({ open, onClose, isMobile = false }: HelpModalProps) {
  const [page, setPage] = useState<HelpPage>("home")

  // Always land on the main help page when the modal is reopened.
  useEffect(() => {
    if (open) setPage("home")
  }, [open])

  return (
    <Dialog.Root open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={cn(
          "fixed inset-0 z-50 transition-opacity duration-300 bg-black/15 backdrop-blur-[1px]",
          open ? "opacity-100" : "opacity-0"
        )} />
        <Dialog.Content
          onCloseAutoFocus={(e) => { e.preventDefault(); focusChatPrompt() }}
          className={cn(
            "fixed z-50 bg-popover overflow-hidden flex flex-col",
            isMobile
              ? "inset-x-4 top-1/2 -translate-y-1/2 rounded-xl"
              : "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-xl border border-border rounded-xl shadow-xl"
          )}
        >
          {page === "home" ? (
            <HomePage isMobile={isMobile} onOpenShortcuts={() => setPage("shortcuts")} />
          ) : (
            <ShortcutsPage isMobile={isMobile} onBack={() => setPage("home")} />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function HomePage({ isMobile, onOpenShortcuts }: { isMobile: boolean; onOpenShortcuts: () => void }) {
  return (
    <>
      <ModalHeader
        title={
          <>
            <HelpCircle className="h-4 w-4" />
            Help
          </>
        }
      />

      <div className={cn(
        "space-y-4 text-sm",
        isMobile ? "p-4" : "p-5"
      )}>
        <section className="space-y-2 text-muted-foreground">
          <p>
            Describe what you want built or changed in the message box, and send it. An agent
            works on it in the background — in its own sandbox, on its own branch — so you're
            free to keep chatting, start another chat, or come back later.
          </p>
          <p>
            Type <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">/</code> in the
            prompt for git actions like merge, rebase, squash, and opening a PR.
          </p>
          <p>
            Need help or have feedback? Email{" "}
            <a
              href="mailto:james@backgrounder.dev"
              className="text-foreground underline hover:no-underline"
            >
              james@backgrounder.dev
            </a>.
          </p>
        </section>

        <button
          onClick={onOpenShortcuts}
          className="flex w-full items-center justify-between rounded-md border border-border px-3 py-2 text-sm hover:bg-accent transition-colors cursor-pointer"
        >
          <span className="flex items-center gap-2">
            <Keyboard className="h-4 w-4" />
            Keyboard shortcuts
          </span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </button>
      </div>
    </>
  )
}

function ShortcutsPage({ isMobile, onBack }: { isMobile: boolean; onBack: () => void }) {
  return (
    <>
      <ModalHeader
        title={
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 hover:text-foreground transition-colors cursor-pointer"
          >
            <ChevronLeft className="h-4 w-4" />
            Keyboard shortcuts
          </button>
        }
      />

      <div className={cn(
        "space-y-4 text-sm",
        isMobile ? "p-4" : "p-5"
      )}>
        <section>
          <ul className="space-y-1 text-muted-foreground">
            <li><kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] font-mono">⌘P</kbd> / <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] font-mono">Ctrl+P</kbd> Search chats, repos, and branches</li>
            <li><kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] font-mono">⌘K</kbd> / <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] font-mono">Ctrl+K</kbd> Command palette</li>
            <li><kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] font-mono">⌘B</kbd> / <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] font-mono">Ctrl+B</kbd> Toggle sidebar</li>
            <li><kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] font-mono">⌘J</kbd> / <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] font-mono">Ctrl+J</kbd> Toggle terminal</li>
            <li><kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] font-mono">⌘S</kbd> / <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] font-mono">Ctrl+S</kbd> Skills</li>
            <li><kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] font-mono">⌘O</kbd> / <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] font-mono">Ctrl+O</kbd> New chat</li>
            <li><kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] font-mono">⌘⇧O</kbd> / <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] font-mono">Ctrl+Shift+O</kbd> Branch chat</li>
            <li><kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] font-mono">⌥↑/↓</kbd> / <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] font-mono">Alt+↑/↓</kbd> Switch chats</li>
            <li><kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] font-mono">⌥Enter</kbd> / <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] font-mono">Alt+Enter</kbd> or <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] font-mono">⇧Enter</kbd> / <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] font-mono">Shift+Enter</kbd> Branch and send to a new chat</li>
          </ul>
        </section>
      </div>
    </>
  )
}
