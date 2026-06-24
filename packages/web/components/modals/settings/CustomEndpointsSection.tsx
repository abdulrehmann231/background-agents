"use client"

import { useState } from "react"
import { Server, Plus, MoreVertical, Pencil, Copy, Trash2, ArrowLeft } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { CustomEndpoint, CustomEndpointType } from "@/lib/types"
import { MobileSectionHeader } from "./shared"

interface CustomEndpointsSectionProps {
  isMobile: boolean
  endpoints: CustomEndpoint[]
  setEndpoints: (next: CustomEndpoint[]) => void
}

/** The three runtimes a custom endpoint can target, with their UI metadata. */
const TYPE_OPTIONS: {
  type: CustomEndpointType
  label: string
  baseUrlPlaceholder: string
  modelPlaceholder: string
  /** Whether a model id is required (OpenCode addresses models as <provider>/<model>). */
  modelRequired: boolean
  headersPlaceholder: string
}[] = [
  {
    type: "anthropic",
    label: "Anthropic",
    baseUrlPlaceholder: "https://api.anthropic.com",
    modelPlaceholder: "claude-opus-4-1 (optional)",
    modelRequired: false,
    headersPlaceholder: "x-api-key: sk-ant-…\n# or: Authorization: Bearer <token>",
  },
  {
    type: "codex",
    label: "Codex",
    baseUrlPlaceholder: "https://api.openai.com/v1",
    modelPlaceholder: "gpt-5.5 (optional)",
    modelRequired: false,
    headersPlaceholder: "Authorization: Bearer sk-…\n# or: x-api-key: <token>",
  },
  {
    type: "opencode",
    label: "OpenCode",
    baseUrlPlaceholder: "https://openrouter.ai/api/v1",
    modelPlaceholder: "gpt-4o-mini",
    modelRequired: true,
    headersPlaceholder: "Authorization: Bearer sk-…\n# or: x-api-key: <token>",
  },
]

function typeMeta(type: CustomEndpointType) {
  return TYPE_OPTIONS.find((t) => t.type === type) ?? TYPE_OPTIONS[0]
}

function newEndpoint(): CustomEndpoint {
  return {
    id: crypto.randomUUID(),
    name: "",
    type: "anthropic",
    baseUrl: "",
    model: "",
    headers: "",
  }
}

/**
 * "Custom endpoints" tab. Two views over the same lifted list:
 *  - List: each endpoint as a row with a ⋮ menu (Edit / Duplicate / Delete).
 *  - Form: add or edit one endpoint's fields, with a Back link to the list.
 * Edits apply live to the lifted state; the settings modal's own Save / Cancel
 * persists or discards the whole list (and validates required fields on Save).
 */
export function CustomEndpointsSection({
  isMobile,
  endpoints,
  setEndpoints,
}: CustomEndpointsSectionProps) {
  // The endpoint open in the form, or null for the list view.
  const [editingId, setEditingId] = useState<string | null>(null)

  const update = (id: string, patch: Partial<CustomEndpoint>) => {
    setEndpoints(endpoints.map((e) => (e.id === id ? { ...e, ...patch } : e)))
  }
  const addAndEdit = () => {
    const created = newEndpoint()
    setEndpoints([...endpoints, created])
    setEditingId(created.id)
  }
  const duplicate = (e: CustomEndpoint) =>
    setEndpoints([...endpoints, { ...e, id: crypto.randomUUID(), name: `${e.name} copy` }])
  const remove = (id: string) => setEndpoints(endpoints.filter((e) => e.id !== id))

  const editing = editingId ? endpoints.find((e) => e.id === editingId) ?? null : null

  // Leave the form. Drop a wholly-empty endpoint (e.g. an "Add" the user backed
  // out of) so it doesn't linger in the list or block the modal's Save.
  const goBack = () => {
    if (editing && !editing.name && !editing.baseUrl && !editing.model && !editing.headers) {
      remove(editing.id)
    }
    setEditingId(null)
  }

  // Form view
  if (editing) {
    return (
      <div>
        {isMobile && <MobileSectionHeader icon={Server} label="Custom endpoints" />}
        <button
          type="button"
          onClick={goBack}
          className="mb-3 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> All endpoints
        </button>
        <EndpointForm endpoint={editing} onChange={(patch) => update(editing.id, patch)} />
      </div>
    )
  }

  // List view
  return (
    <div>
      {isMobile && <MobileSectionHeader icon={Server} label="Custom endpoints" />}

      <div className="flex items-center justify-between mb-3 gap-3">
        <p className="text-xs text-muted-foreground">
          Point an agent at your own, self-hosted, or proxied endpoint. Each one
          appears by name in the model dropdown. Put auth in the Headers field.
        </p>
        <button
          type="button"
          onClick={addAndEdit}
          className="flex shrink-0 items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer"
        >
          <Plus className="h-3.5 w-3.5" /> Add endpoint
        </button>
      </div>

      {endpoints.length === 0 ? (
        <div className="rounded-md border border-dashed border-border/60 py-8 text-center text-sm text-muted-foreground">
          No custom endpoints yet.
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {endpoints.map((e) => (
            <li
              key={e.id}
              className="flex items-center gap-3 rounded-md border border-border/40 px-3 py-2.5"
            >
              <button
                type="button"
                onClick={() => setEditingId(e.id)}
                className="min-w-0 flex-1 text-left cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">
                    {e.name || "Untitled endpoint"}
                  </span>
                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {typeMeta(e.type).label}
                  </span>
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {e.baseUrl || "No base URL"}
                </div>
              </button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="Endpoint options"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors cursor-pointer hover:bg-accent hover:text-foreground"
                  >
                    <MoreVertical className="h-4 w-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setEditingId(e.id)}>
                    <Pencil className="mr-2 h-3.5 w-3.5" /> Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => duplicate(e)}>
                    <Copy className="mr-2 h-3.5 w-3.5" /> Duplicate
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => remove(e.id)}
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function EndpointForm({
  endpoint,
  onChange,
}: {
  endpoint: CustomEndpoint
  onChange: (patch: Partial<CustomEndpoint>) => void
}) {
  const meta = typeMeta(endpoint.type)

  return (
    <div>
      <Field label="Name" required>
        <Input
          value={endpoint.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="My proxy"
          autoComplete="off"
          spellCheck={false}
        />
      </Field>

      <Field label="Type">
        <Select
          value={endpoint.type}
          onValueChange={(v) => onChange({ type: v as CustomEndpointType })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TYPE_OPTIONS.map((t) => (
              <SelectItem key={t.type} value={t.type}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field label="Base URL" required>
        <Input
          value={endpoint.baseUrl}
          onChange={(e) => onChange({ baseUrl: e.target.value })}
          placeholder={meta.baseUrlPlaceholder}
          autoComplete="off"
          spellCheck={false}
          className="font-mono"
        />
      </Field>

      <Field
        label="Model"
        required={meta.modelRequired}
        hint={
          meta.modelRequired
            ? "The exact model id the endpoint expects."
            : "Sent to --model. Leave blank to use the endpoint default."
        }
      >
        <Input
          value={endpoint.model}
          onChange={(e) => onChange({ model: e.target.value })}
          placeholder={meta.modelPlaceholder}
          autoComplete="off"
          spellCheck={false}
          className="font-mono"
        />
      </Field>

      <Field label="Headers" hint="One per line — Header-Name: value. Put auth here.">
        <Textarea
          value={endpoint.headers}
          onChange={(e) => onChange({ headers: e.target.value })}
          placeholder={meta.headersPlaceholder}
          rows={3}
          autoComplete="off"
          spellCheck={false}
          data-lpignore="true"
          data-1p-ignore="true"
          data-bwignore="true"
          data-form-type="other"
          className="font-mono text-xs"
        />
      </Field>
    </div>
  )
}

/** A stacked label + control used inside the endpoint form. */
function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string
  required?: boolean
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="mb-3">
      <div className="mb-1 text-xs font-medium">
        {label}
        {required && <span className="text-destructive"> *</span>}
        {hint && <span className="ml-2 font-normal text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </div>
  )
}
