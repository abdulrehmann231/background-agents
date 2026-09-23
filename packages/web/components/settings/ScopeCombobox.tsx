"use client"

import { useMemo, useState } from "react"
import { Check, ChevronDown, FolderGit2, MessageSquare, Wallet } from "lucide-react"
import { cn } from "@/lib/utils"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import type { UsageScopeOption } from "@/lib/db/user-usage"

/** The whole-account scope, as both the value and the query param. */
export const ACCOUNT_SCOPE = "account"

interface ScopeComboboxProps {
  value: string
  onChange: (next: string) => void
  options?: { repos: UsageScopeOption[]; chats: UsageScopeOption[] }
  disabled?: boolean
}

/**
 * Picks what the Usage tab is showing: the whole account, one repo, or one
 * chat.
 *
 * A searchable combobox rather than a plain select, because the lists are
 * unbounded — an active account has dozens of chats, and scrolling a native
 * dropdown to find one by eye is the wrong tool. Follows BranchCombobox: a
 * popover over cmdk, filtered here rather than by cmdk so a repo can match on
 * its slug and a chat on its name.
 */
export function ScopeCombobox({ value, onChange, options, disabled }: ScopeComboboxProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")

  const repos = useMemo(() => options?.repos ?? [], [options])
  const chats = useMemo(() => options?.chats ?? [], [options])

  const query = search.trim().toLowerCase()
  const match = (option: UsageScopeOption) =>
    !query ||
    option.label.toLowerCase().includes(query) ||
    option.key.toLowerCase().includes(query)

  const filteredRepos = repos.filter(match)
  const filteredChats = chats.filter(match)
  const showAccount = !query || "whole account".includes(query)

  // The label has to survive an option list that hasn't loaded yet, and a scope
  // whose repo or chat has since dropped out of the window.
  const current = useMemo(() => {
    if (value === ACCOUNT_SCOPE) return { label: "Whole account", Icon: Wallet }
    if (value.startsWith("repo:")) {
      const key = value.slice(5)
      return { label: repos.find((r) => r.key === key)?.label ?? key, Icon: FolderGit2 }
    }
    const key = value.slice(5)
    return { label: chats.find((c) => c.key === key)?.label ?? "This chat", Icon: MessageSquare }
  }, [value, repos, chats])

  const select = (next: string) => {
    onChange(next)
    setSearch("")
    setOpen(false)
  }

  const CurrentIcon = current.Icon

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setSearch("")
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          title={current.label}
          aria-label={`Scope: ${current.label}`}
          className={cn(
            "flex h-8 max-w-56 items-center gap-1.5 rounded-md border border-border/60 px-2.5 text-xs",
            "transition-colors hover:bg-accent/50 cursor-pointer",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
            disabled && "cursor-not-allowed opacity-50"
          )}
        >
          <CurrentIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{current.label}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start" side="bottom" sideOffset={6}>
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search repos and chats..."
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>Nothing matches that</CommandEmpty>

            {showAccount && (
              <CommandGroup>
                <ScopeItem
                  icon={Wallet}
                  label="Whole account"
                  selected={value === ACCOUNT_SCOPE}
                  onSelect={() => select(ACCOUNT_SCOPE)}
                />
              </CommandGroup>
            )}

            {filteredRepos.length > 0 && (
              <CommandGroup heading="Repositories">
                {filteredRepos.map((repo) => (
                  <ScopeItem
                    key={repo.key}
                    icon={FolderGit2}
                    label={repo.label}
                    selected={value === `repo:${repo.key}`}
                    onSelect={() => select(`repo:${repo.key}`)}
                  />
                ))}
              </CommandGroup>
            )}

            {filteredChats.length > 0 && (
              <CommandGroup heading="Chats">
                {filteredChats.map((chat) => (
                  <ScopeItem
                    key={chat.key}
                    icon={MessageSquare}
                    label={chat.label}
                    selected={value === `chat:${chat.key}`}
                    onSelect={() => select(`chat:${chat.key}`)}
                  />
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function ScopeItem({
  icon: Icon,
  label,
  selected,
  onSelect,
}: {
  icon: typeof FolderGit2
  label: string
  selected: boolean
  onSelect: () => void
}) {
  return (
    <CommandItem
      value={label}
      onSelect={onSelect}
      className={cn("flex cursor-pointer items-center gap-2", selected && "bg-accent")}
    >
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="flex-1 truncate">{label}</span>
      {selected && <Check className="h-3.5 w-3.5 shrink-0" />}
    </CommandItem>
  )
}
