"use client"

/**
 * Shared "master cockpit" primitives used by both /master/vendors and
 * /master/customers. Each piece is intentionally generic so the two pages can
 * stay declarative.
 *
 *   • CockpitShell           page chrome: hero + KPI strip + filter spine + grid + drawer
 *   • DataGrid               sortable header, selection column, click-row → drawer
 *   • DetailDrawer           tabbed right panel anchored to the selected row
 *   • CreateModal            modal-style create form (instead of right-rail clutter)
 *   • ConfirmDialog          shared yes/no for deactivate / delete
 *   • ContactList            multi-contact editor with one-click "make primary"
 *
 * Styling intentionally follows the reports-primitives.tsx language so the two
 * surfaces feel like one system.
 */

import { Fragment, type ReactNode, useEffect, useMemo, useState } from "react"
import { ArrowDown, ArrowUp, Mail, Phone, Plus, Search, Star, Trash2, X } from "lucide-react"
import { cn } from "@/lib/utils"

// ──────────────────────────────────────────────────────────────────────────
// CockpitShell — page shell (hero + KPI strip + filter spine + body slot)
// ──────────────────────────────────────────────────────────────────────────

export function CockpitShell({
  hero,
  kpis,
  filters,
  children,
}: {
  hero: ReactNode
  kpis: ReactNode
  filters: ReactNode
  children: ReactNode
}) {
  return (
    <div className="space-y-5 px-6 pb-10 pt-2">
      {hero}
      <div className="grid gap-3 grid-cols-2 md:grid-cols-2 xl:grid-cols-4">{kpis}</div>
      <div className="flex flex-wrap items-center gap-3 rounded-[1.4rem] border border-slate-200 bg-white px-4 py-3 shadow-sm">
        {filters}
      </div>
      {children}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// MasterHero — hero band matching the mockup gradient
// ──────────────────────────────────────────────────────────────────────────

export function MasterHero({
  eyebrow,
  title,
  description,
  chips,
  accent = "cyan",
}: {
  eyebrow: string
  title: string
  description?: string
  chips?: Array<{ label: string; tone?: "ok" | "warn" | "critical" | "neutral" }>
  accent?: "cyan" | "emerald"
}) {
  const gradients: Record<string, string> = {
    cyan: "radial-gradient(120% 90% at 0% 0%, rgba(14,116,144,0.22), transparent 50%), radial-gradient(80% 70% at 100% 0%, rgba(245,158,11,0.14), transparent 55%), linear-gradient(135deg, #0b1220 0%, #14274b 60%, #1d4ed8 100%)",
    emerald:
      "radial-gradient(120% 90% at 0% 0%, rgba(4,120,87,0.22), transparent 50%), radial-gradient(80% 70% at 100% 0%, rgba(245,158,11,0.14), transparent 55%), linear-gradient(135deg, #0b1220 0%, #064e3b 60%, #047857 100%)",
  }
  const toneCls = (t?: string) =>
    t === "ok"
      ? "border-emerald-300/40 bg-emerald-400/15 text-emerald-100"
      : t === "warn"
        ? "border-amber-300/40 bg-amber-400/15 text-amber-100"
        : t === "critical"
          ? "border-rose-300/40 bg-rose-400/15 text-rose-100"
          : "border-white/30 bg-white/10 text-white/90"
  return (
    <section
      className="relative overflow-hidden rounded-[2rem] px-6 py-7 text-white shadow-[0_25px_70px_rgba(15,23,42,0.18)]"
      style={{ backgroundImage: gradients[accent] }}
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/70">{eyebrow}</p>
      <h1 className="mt-3 max-w-4xl text-3xl font-semibold tracking-tight md:text-[32px]">{title}</h1>
      {description ? <p className="mt-3 max-w-3xl text-sm leading-6 text-white/75">{description}</p> : null}
      {chips?.length ? (
        <div className="mt-5 flex flex-wrap gap-2">
          {chips.map((c) => (
            <span
              key={c.label}
              className={cn("rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em]", toneCls(c.tone))}
            >
              {c.label}
            </span>
          ))}
        </div>
      ) : null}
    </section>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// KpiTile — small KPI card for the strip
// ──────────────────────────────────────────────────────────────────────────

export type KpiTileTone = "cyan" | "amber" | "emerald" | "rose" | "violet" | "slate"

export function KpiTile({
  label,
  value,
  detail,
  tone = "slate",
  delta,
}: {
  label: string
  value: string
  detail?: string
  tone?: KpiTileTone
  delta?: { value: string; direction?: "up" | "down" | "flat"; label?: string }
}) {
  const toneBg: Record<KpiTileTone, string> = {
    cyan: "border-cyan-200 bg-cyan-50/80",
    amber: "border-amber-200 bg-amber-50/80",
    emerald: "border-emerald-200 bg-emerald-50/80",
    rose: "border-rose-200 bg-rose-50/80",
    violet: "border-violet-200 bg-violet-50/80",
    slate: "border-slate-200 bg-white",
  }
  return (
    <div className={cn("rounded-[1.25rem] border p-4 shadow-[0_8px_24px_rgba(15,23,42,0.05)]", toneBg[tone])}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{value}</p>
      {detail ? <p className="mt-1 text-[11px] text-slate-500">{detail}</p> : null}
      {delta ? (
        <p
          className={cn(
            "mt-2 text-[11px] font-semibold",
            delta.direction === "up" && "text-emerald-700",
            delta.direction === "down" && "text-rose-700",
            (!delta.direction || delta.direction === "flat") && "text-slate-500",
          )}
        >
          {delta.direction === "up" ? "▲ " : delta.direction === "down" ? "▼ " : "• "}
          {delta.value}
          {delta.label ? <span className="ml-1 font-normal text-slate-500">{delta.label}</span> : null}
        </p>
      ) : null}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// FilterField — label + child slot for the filter spine
// ──────────────────────────────────────────────────────────────────────────

export function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
      <span>{label}</span>
      <span className="text-slate-900 font-medium tracking-normal normal-case text-sm">{children}</span>
    </label>
  )
}

export function SearchField({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (next: string) => void
  placeholder?: string
}) {
  return (
    <span className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm">
      <Search className="h-3.5 w-3.5 text-slate-400" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || "Search…"}
        className="w-[200px] bg-transparent outline-none placeholder:text-slate-400"
      />
    </span>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// DataGrid — sortable header + selection + row-click
// ──────────────────────────────────────────────────────────────────────────

export type GridColumn<T> = {
  key: string
  label: string
  width?: string
  align?: "left" | "right" | "center"
  sortAccessor?: (row: T) => number | string | null | undefined
  render: (row: T) => ReactNode
}

export function DataGrid<T extends { id: string }>({
  columns,
  rows,
  selectedId,
  onSelect,
  selection = new Set<string>(),
  onToggleSelect,
  onToggleSelectAll,
  emptyHint,
}: {
  columns: GridColumn<T>[]
  rows: T[]
  selectedId?: string | null
  onSelect?: (row: T) => void
  selection?: Set<string>
  onToggleSelect?: (id: string) => void
  onToggleSelectAll?: (next: boolean) => void
  emptyHint?: string
}) {
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")

  const sortedRows = useMemo(() => {
    if (!sortKey) return rows
    const col = columns.find((c) => c.key === sortKey)
    if (!col?.sortAccessor) return rows
    const copy = [...rows]
    copy.sort((a, b) => {
      const av = col.sortAccessor!(a)
      const bv = col.sortAccessor!(b)
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv))
      return sortDir === "asc" ? cmp : -cmp
    })
    return copy
  }, [rows, sortKey, sortDir, columns])

  const setSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortKey(key)
      setSortDir("asc")
    }
  }

  const allSelected = rows.length > 0 && rows.every((r) => selection.has(r.id))
  return (
    <div className="overflow-hidden rounded-[1.4rem] border border-slate-200 bg-white shadow-[0_8px_24px_rgba(15,23,42,0.05)]">
      <div className="grid grid-cols-[minmax(0,1fr)] overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/70 text-left text-[10.5px] font-semibold uppercase tracking-[0.12em] text-slate-500">
              <th className="w-10 py-2 pl-3 pr-2 align-middle">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 cursor-pointer accent-slate-900"
                  checked={allSelected}
                  onChange={(e) => onToggleSelectAll?.(e.target.checked)}
                  aria-label="Select all rows"
                />
              </th>
              {columns.map((c) => {
                const isSorted = sortKey === c.key
                return (
                  <th
                    key={c.key}
                    style={{ width: c.width, textAlign: c.align || "left" }}
                    className={cn("py-2 pr-3 align-middle", c.sortAccessor && "cursor-pointer hover:text-slate-900")}
                    onClick={() => c.sortAccessor && setSort(c.key)}
                  >
                    <span className="inline-flex items-center gap-1">
                      {c.label}
                      {isSorted ? (
                        sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                      ) : null}
                    </span>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {sortedRows.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 1} className="py-10 text-center text-sm text-slate-500">
                  {emptyHint || "No rows match the current filters."}
                </td>
              </tr>
            ) : (
              sortedRows.map((row) => {
                const isSel = selectedId === row.id
                return (
                  <tr
                    key={row.id}
                    onClick={() => onSelect?.(row)}
                    className={cn(
                      "border-b border-slate-100 cursor-pointer last:border-b-0",
                      isSel ? "bg-cyan-50/60 shadow-[inset_3px_0_0_#0e7490]" : "hover:bg-slate-50",
                    )}
                  >
                    <td className="py-2 pl-3 pr-2 align-middle" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5 cursor-pointer accent-slate-900"
                        checked={selection.has(row.id)}
                        onChange={() => onToggleSelect?.(row.id)}
                        aria-label="Select row"
                      />
                    </td>
                    {columns.map((c) => (
                      <td
                        key={c.key}
                        style={{ width: c.width, textAlign: c.align || "left" }}
                        className="py-2 pr-3 align-middle text-slate-800"
                      >
                        {c.render(row)}
                      </td>
                    ))}
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// DetailDrawer — sticky right-side panel with tabs
// ──────────────────────────────────────────────────────────────────────────

export type DrawerTab = { key: string; label: string; count?: number; content: ReactNode }

export function DetailDrawer({
  open,
  title,
  subtitle,
  chips,
  accent = "cyan",
  tabs,
  initialTab,
  footer,
  onClose,
}: {
  open: boolean
  title: string
  subtitle?: string
  chips?: Array<{ label: string; tone?: "ok" | "warn" | "critical" }>
  accent?: "cyan" | "emerald"
  tabs: DrawerTab[]
  initialTab?: string
  footer?: ReactNode
  onClose?: () => void
}) {
  const [activeKey, setActiveKey] = useState<string>(initialTab || tabs[0]?.key)
  useEffect(() => {
    if (initialTab) setActiveKey(initialTab)
  }, [initialTab])
  useEffect(() => {
    if (!tabs.find((t) => t.key === activeKey) && tabs.length) {
      setActiveKey(tabs[0].key)
    }
  }, [tabs, activeKey])
  if (!open) {
    return (
      <div className="flex h-full min-h-[280px] items-center justify-center rounded-[1.4rem] border border-dashed border-slate-200 bg-slate-50 px-6 py-10 text-center text-sm text-slate-500">
        Select a row from the grid to open its detail panel.
      </div>
    )
  }
  const active = tabs.find((t) => t.key === activeKey) || tabs[0]
  const headerGradient =
    accent === "emerald"
      ? "linear-gradient(160deg, #0b1220 0%, #047857 100%)"
      : "linear-gradient(160deg, #0b1220 0%, #0e7490 100%)"
  const tabBorder = accent === "emerald" ? "border-emerald-600" : "border-cyan-700"
  return (
    <section className="sticky top-6 overflow-hidden rounded-[1.4rem] border border-slate-200 bg-white shadow-[0_18px_50px_rgba(15,23,42,0.08)]">
      <div className="px-5 py-4 text-white" style={{ backgroundImage: headerGradient }}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/70">Selected</p>
            <h2 className="mt-1 truncate text-lg font-semibold tracking-tight">{title}</h2>
            {subtitle ? <p className="mt-0.5 text-xs text-white/80">{subtitle}</p> : null}
          </div>
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1.5 text-white/80 transition hover:bg-white/10 hover:text-white"
              aria-label="Close drawer"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
        {chips?.length ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {chips.map((c) => (
              <span
                key={c.label}
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                  c.tone === "critical"
                    ? "border-rose-300/50 bg-rose-400/20 text-rose-100"
                    : c.tone === "warn"
                      ? "border-amber-300/50 bg-amber-400/20 text-amber-100"
                      : "border-emerald-300/50 bg-emerald-400/20 text-emerald-100",
                )}
              >
                {c.label}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <div className="flex gap-1 overflow-x-auto border-b border-slate-200 bg-slate-50/70 px-3 pt-2">
        {tabs.map((t) => {
          const isActive = t.key === active.key
          return (
            <button
              type="button"
              key={t.key}
              onClick={() => setActiveKey(t.key)}
              className={cn(
                "shrink-0 border-b-2 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] transition",
                isActive ? `${tabBorder} text-slate-900` : "border-transparent text-slate-500 hover:text-slate-800",
              )}
            >
              {t.label}
              {typeof t.count === "number" ? (
                <span className="ml-1 rounded-full bg-slate-200 px-1.5 py-0.5 text-[9px] font-bold text-slate-700">
                  {t.count}
                </span>
              ) : null}
            </button>
          )
        })}
      </div>
      <div className="max-h-[60vh] overflow-y-auto px-5 py-4">{active?.content}</div>
      {footer ? <div className="border-t border-slate-200 bg-slate-50/70 px-5 py-3">{footer}</div> : null}
    </section>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// CreateModal — generic modal shell
// ──────────────────────────────────────────────────────────────────────────

export function Modal({
  open,
  onClose,
  title,
  eyebrow,
  children,
  footer,
  size = "md",
}: {
  open: boolean
  onClose: () => void
  title: string
  eyebrow?: string
  children: ReactNode
  footer?: ReactNode
  size?: "sm" | "md" | "lg"
}) {
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => e.key === "Escape" && onClose()
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [open, onClose])
  if (!open) return null
  const sizeCls = size === "lg" ? "max-w-2xl" : size === "sm" ? "max-w-md" : "max-w-xl"
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-4 py-8"
      onClick={onClose}
    >
      <div
        className={cn("w-full max-h-[88vh] overflow-hidden rounded-[1.4rem] border border-slate-200 bg-white shadow-[0_30px_80px_rgba(15,23,42,0.25)]", sizeCls)}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div>
            {eyebrow ? <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">{eyebrow}</p> : null}
            <h2 className="mt-0.5 text-base font-semibold tracking-tight text-slate-950">{title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
            aria-label="Close modal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[64vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer ? <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50/70 px-5 py-3">{footer}</div> : null}
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// LabeledInput — reusable form field
// ──────────────────────────────────────────────────────────────────────────

export function LabeledInput({
  label,
  value,
  onChange,
  placeholder,
  required,
  type = "text",
  hint,
}: {
  label: string
  value: string
  onChange: (next: string) => void
  placeholder?: string
  required?: boolean
  type?: string
  hint?: string
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
        {label} {required ? <span className="text-rose-700">*</span> : null}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 focus:border-cyan-400 focus:outline-none"
      />
      {hint ? <span className="text-[10.5px] text-slate-500">{hint}</span> : null}
    </label>
  )
}

export function LabeledTextarea({
  label,
  value,
  onChange,
  placeholder,
  required,
  rows = 3,
}: {
  label: string
  value: string
  onChange: (next: string) => void
  placeholder?: string
  required?: boolean
  rows?: number
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
        {label} {required ? <span className="text-rose-700">*</span> : null}
      </span>
      <textarea
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 focus:border-cyan-400 focus:outline-none"
      />
    </label>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Pill / StatusPill
// ──────────────────────────────────────────────────────────────────────────

export function Pill({
  tone = "neutral",
  children,
}: {
  tone?: "ok" | "warn" | "critical" | "info" | "neutral"
  children: ReactNode
}) {
  const cls =
    tone === "ok"
      ? "bg-emerald-100 text-emerald-900 border-emerald-200"
      : tone === "warn"
        ? "bg-amber-100 text-amber-900 border-amber-200"
        : tone === "critical"
          ? "bg-rose-100 text-rose-900 border-rose-200"
          : tone === "info"
            ? "bg-cyan-100 text-cyan-900 border-cyan-200"
            : "bg-slate-100 text-slate-700 border-slate-200"
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider", cls)}>
      {children}
    </span>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// ContactList — multi-contact editor with primary-promote
// ──────────────────────────────────────────────────────────────────────────

export type ContactRow = {
  id: string
  contact_name?: string | null
  contact_phone?: string | null
  contact_email?: string | null
  designation?: string | null
  is_primary?: boolean | null
}

export function ContactList({
  contacts,
  loading,
  onAdd,
  onUpdate,
  onDelete,
  onMakePrimary,
  busy,
}: {
  contacts: ContactRow[]
  loading?: boolean
  onAdd: (data: { contact_name: string; contact_phone: string; contact_email: string; designation: string }) => Promise<void> | void
  onUpdate: (id: string, data: Partial<ContactRow>) => Promise<void> | void
  onDelete: (id: string) => Promise<void> | void
  onMakePrimary?: (id: string) => Promise<void> | void
  busy?: boolean
}) {
  const [draft, setDraft] = useState({ contact_name: "", contact_phone: "", contact_email: "", designation: "" })
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<Partial<ContactRow>>({})
  const [error, setError] = useState<string | null>(null)

  const startEdit = (c: ContactRow) => {
    setEditingId(c.id)
    setEditDraft({
      contact_name: c.contact_name || "",
      contact_phone: c.contact_phone || "",
      contact_email: c.contact_email || "",
      designation: c.designation || "",
    })
    setError(null)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditDraft({})
  }

  const saveEdit = async () => {
    if (!editingId) return
    if (!(editDraft.contact_name || "").trim()) {
      setError("Contact name is required.")
      return
    }
    try {
      await onUpdate(editingId, editDraft)
      cancelEdit()
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || "Failed to update contact.")
    }
  }

  const submit = async () => {
    if (!draft.contact_name.trim()) {
      setError("Contact name is required.")
      return
    }
    try {
      await onAdd(draft)
      setDraft({ contact_name: "", contact_phone: "", contact_email: "", designation: "" })
      setError(null)
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || "Failed to add contact.")
    }
  }

  const primary = contacts.find((c) => c.is_primary)
  const others = contacts.filter((c) => !c.is_primary)

  return (
    <div className="space-y-3">
      {primary ? (
        <ContactCard
          contact={primary}
          isPrimary
          isEditing={editingId === primary.id}
          editDraft={editDraft}
          onEditChange={setEditDraft}
          onStartEdit={() => startEdit(primary)}
          onCancelEdit={cancelEdit}
          onSaveEdit={saveEdit}
          onDelete={() => onDelete(primary.id)}
          busy={busy}
        />
      ) : null}
      {others.length ? (
        <div className="space-y-2">
          {others.map((c) => (
            <ContactCard
              key={c.id}
              contact={c}
              isEditing={editingId === c.id}
              editDraft={editDraft}
              onEditChange={setEditDraft}
              onStartEdit={() => startEdit(c)}
              onCancelEdit={cancelEdit}
              onSaveEdit={saveEdit}
              onDelete={() => onDelete(c.id)}
              onMakePrimary={onMakePrimary ? () => onMakePrimary(c.id) : undefined}
              busy={busy}
            />
          ))}
        </div>
      ) : null}
      {!loading && contacts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-center text-[11px] text-slate-500">
          No contacts yet. Add the first contact below — it becomes the primary.
        </div>
      ) : null}

      <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">+ Add contact</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <LabeledInput
            label="Name"
            required
            value={draft.contact_name}
            onChange={(v) => setDraft({ ...draft, contact_name: v })}
          />
          <LabeledInput
            label="Designation"
            value={draft.designation}
            onChange={(v) => setDraft({ ...draft, designation: v })}
            placeholder="e.g. Purchase head"
          />
          <LabeledInput
            label="Phone"
            value={draft.contact_phone}
            onChange={(v) => setDraft({ ...draft, contact_phone: v })}
            placeholder="+91 …"
          />
          <LabeledInput
            label="Email"
            value={draft.contact_email}
            onChange={(v) => setDraft({ ...draft, contact_email: v })}
            placeholder="name@…"
          />
        </div>
        {error ? <p className="mt-2 text-xs font-medium text-rose-700">{error}</p> : null}
        <div className="mt-3 flex items-center justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={submit}
            className="inline-flex items-center gap-1 rounded-full bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white shadow hover:bg-slate-900 disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" /> Add contact
          </button>
        </div>
      </div>
    </div>
  )
}

function ContactCard({
  contact,
  isPrimary,
  isEditing,
  editDraft,
  onEditChange,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  onMakePrimary,
  busy,
}: {
  contact: ContactRow
  isPrimary?: boolean
  isEditing: boolean
  editDraft: Partial<ContactRow>
  onEditChange: (next: Partial<ContactRow>) => void
  onStartEdit: () => void
  onCancelEdit: () => void
  onSaveEdit: () => void
  onDelete: () => void
  onMakePrimary?: () => void
  busy?: boolean
}) {
  return (
    <div
      className={cn(
        "rounded-xl border px-3 py-2.5 transition",
        isPrimary ? "border-emerald-300 bg-emerald-50" : "border-slate-200 bg-white",
      )}
    >
      {isEditing ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <LabeledInput
            label="Name"
            required
            value={editDraft.contact_name || ""}
            onChange={(v) => onEditChange({ ...editDraft, contact_name: v })}
          />
          <LabeledInput
            label="Designation"
            value={editDraft.designation || ""}
            onChange={(v) => onEditChange({ ...editDraft, designation: v })}
          />
          <LabeledInput
            label="Phone"
            value={editDraft.contact_phone || ""}
            onChange={(v) => onEditChange({ ...editDraft, contact_phone: v })}
          />
          <LabeledInput
            label="Email"
            value={editDraft.contact_email || ""}
            onChange={(v) => onEditChange({ ...editDraft, contact_email: v })}
          />
          <div className="sm:col-span-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onCancelEdit}
              className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-slate-400"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onSaveEdit}
              disabled={busy}
              className="rounded-full bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white shadow hover:bg-slate-900 disabled:opacity-50"
            >
              Save
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-slate-950">{contact.contact_name || "—"}</span>
              {isPrimary ? <Pill tone="ok">Primary</Pill> : null}
              {contact.designation ? <span className="text-[11px] text-slate-500">{contact.designation}</span> : null}
            </div>
            <div className="mt-1 flex flex-wrap gap-3 text-[11.5px] text-slate-600">
              {contact.contact_phone ? (
                <span className="inline-flex items-center gap-1">
                  <Phone className="h-3 w-3" /> {contact.contact_phone}
                </span>
              ) : null}
              {contact.contact_email ? (
                <span className="inline-flex items-center gap-1">
                  <Mail className="h-3 w-3" /> {contact.contact_email}
                </span>
              ) : null}
              {!contact.contact_phone && !contact.contact_email ? <span className="text-slate-400">— no phone or email —</span> : null}
            </div>
          </div>
          <div className="flex shrink-0 gap-1">
            {!isPrimary && onMakePrimary ? (
              <button
                type="button"
                onClick={onMakePrimary}
                title="Make primary"
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-700 hover:border-emerald-300 hover:text-emerald-700"
              >
                <Star className="h-3 w-3" /> Primary
              </button>
            ) : null}
            <button
              type="button"
              onClick={onStartEdit}
              className="rounded-md border border-slate-200 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-700 hover:border-cyan-300 hover:text-cyan-700"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={onDelete}
              title="Delete contact"
              className="rounded-md border border-slate-200 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-rose-600 hover:border-rose-300"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Confirm dialog (used by Deactivate / Delete)
// ──────────────────────────────────────────────────────────────────────────

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = "Confirm",
  tone = "warn",
  onConfirm,
  onClose,
  busy,
}: {
  open: boolean
  title: string
  body: ReactNode
  confirmLabel?: string
  tone?: "warn" | "critical"
  onConfirm: () => void
  onClose: () => void
  busy?: boolean
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <Fragment>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-slate-400"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={cn(
              "rounded-full px-3 py-1.5 text-xs font-semibold text-white shadow",
              tone === "critical" ? "bg-rose-700 hover:bg-rose-800" : "bg-amber-700 hover:bg-amber-800",
              busy && "opacity-50",
            )}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </Fragment>
      }
    >
      <div className="text-sm leading-6 text-slate-700">{body}</div>
    </Modal>
  )
}
