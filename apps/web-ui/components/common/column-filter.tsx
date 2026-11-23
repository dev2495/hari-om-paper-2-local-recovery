"use client"

// Column sort and filter for master tables (client 2026-11-23: "on all master pages provide column filters,
// high / low, easy, on all columns"). Each column header gets a sort button (A→Z / low→high, then Z→A /
// high→low, then off) and a filter button: numbers get Min / Max, text gets "Contains" and a pick list of the
// values in that column. The table keeps its own rows; useColumnFilters returns them filtered and sorted.

import { isValidElement, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { ArrowDown, ArrowUp, ArrowUpDown, Filter, X } from "lucide-react"
import { cn } from "@/lib/utils"

export type FilterColumn<T> = {
  key: string
  label: string
  /** The cell's value: a string or number, or the rendered cell (its text is used). */
  value: (row: T) => unknown
  /** Leave a column out (actions, check boxes). */
  disabled?: boolean
}

type ColumnFilterState = { text?: string; picked?: string[]; min?: string; max?: string }
type SortState = { key: string; dir: "asc" | "desc" } | null

/** Plain text of a value or a rendered cell ("125.55 mm", "Active"). */
export function nodeText(node: unknown): string {
  if (node == null || typeof node === "boolean") return ""
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(nodeText).filter(Boolean).join(" ")
  if (isValidElement(node)) return nodeText((node.props as any)?.children)
  if (node instanceof Date) return node.toISOString()
  if (typeof node === "object") return ""
  return String(node)
}

const NUMBER_TEXT = /^[-+]?(?:\d{1,3}(?:,\d{2,3})+|\d+)?(?:\.\d+)?\s*(?:[a-zA-Z%₹°]{0,4}\.?)$/
const toNumber = (text: string): number | null => {
  const clean = text.replace(/[₹\s]/g, "")
  if (!clean || !/\d/.test(clean) || !NUMBER_TEXT.test(text.trim())) return null
  const value = parseFloat(clean.replace(/,/g, ""))
  return Number.isFinite(value) ? value : null
}

export function useColumnFilters<T>(rows: T[], columns: FilterColumn<T>[]) {
  const [sort, setSort] = useState<SortState>(null)
  const [filters, setFilters] = useState<Record<string, ColumnFilterState>>({})
  const live = columns.filter((column) => !column.disabled)

  // Text of every cell once per data change; a column is numeric when every filled cell reads as a number.
  const table = useMemo(() => {
    const texts = rows.map((row) => Object.fromEntries(live.map((column) => [column.key, nodeText(column.value(row)).replace(/\s+/g, " ").trim()])))
    const numeric: Record<string, boolean> = {}
    const values: Record<string, string[]> = {}
    for (const column of live) {
      const filled = texts.map((text) => text[column.key]).filter((text) => text && text !== "—" && text !== "-")
      numeric[column.key] = filled.length > 0 && filled.every((text) => toNumber(text) !== null)
      values[column.key] = Array.from(new Set(filled)).sort((a, b) => numeric[column.key] ? (toNumber(a) ?? 0) - (toNumber(b) ?? 0) : a.localeCompare(b, undefined, { numeric: true }))
    }
    return { texts, numeric, values }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, live.map((column) => column.key).join("|")])

  const shown = useMemo(() => {
    let order = rows.map((_, index) => index).filter((index) => live.every((column) => {
      const filter = filters[column.key]
      if (!filter) return true
      const text = table.texts[index][column.key] || ""
      if (filter.text && !text.toLowerCase().includes(filter.text.toLowerCase())) return false
      if (filter.picked && !filter.picked.includes(text)) return false
      if (filter.min || filter.max) {
        const value = toNumber(text)
        if (value === null) return false
        if (filter.min && value < Number(filter.min)) return false
        if (filter.max && value > Number(filter.max)) return false
      }
      return true
    }))
    if (sort) {
      const numeric = table.numeric[sort.key]
      order = [...order].sort((a, b) => {
        const at = table.texts[a][sort.key] || ""
        const bt = table.texts[b][sort.key] || ""
        if (!at && !bt) return 0
        if (!at) return 1 // blanks last either way
        if (!bt) return -1
        const cmp = numeric ? (toNumber(at) ?? 0) - (toNumber(bt) ?? 0) : at.localeCompare(bt, undefined, { numeric: true, sensitivity: "base" })
        return sort.dir === "asc" ? cmp : -cmp
      })
    }
    return order.map((index) => rows[index])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, table, filters, sort])

  const activeCount = Object.values(filters).filter((filter) => filter.text || filter.picked || filter.min || filter.max).length
  const setFilter = (key: string, next: ColumnFilterState | null) => setFilters((current) => {
    const copy = { ...current }
    if (!next || !(next.text || next.picked || next.min || next.max)) delete copy[key]
    else copy[key] = next
    return copy
  })

  return {
    rows: shown,
    activeCount,
    sorted: sort,
    clearAll: () => { setFilters({}); setSort(null) },
    /** aria-sort for the <th>. */
    ariaSort: (key: string): "ascending" | "descending" | "none" => (sort?.key === key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"),
    /** The header content: label with sort, and the filter button. */
    header: (key: string, label?: ReactNode) => {
      const column = live.find((row) => row.key === key)
      if (!column) return label ?? null
      return (
        <ColumnHeader
          label={label ?? column.label}
          name={column.label}
          numeric={table.numeric[key]}
          values={table.values[key]}
          sortDir={sort?.key === key ? sort.dir : null}
          onSort={(dir) => setSort(dir ? { key, dir } : null)}
          filter={filters[key]}
          onFilter={(next) => setFilter(key, next)}
        />
      )
    },
  }
}

/** "Showing 12 of 40 · 2 column filters · Clear" line for under a table. */
export function ColumnFilterSummary({ shown, total, activeCount, sorted, onClear }: { shown: number; total: number; activeCount: number; sorted: boolean; onClear: () => void }) {
  if (!activeCount && !sorted) return null
  return (
    <p role="status" className="flex flex-wrap items-center gap-2 px-4 py-2 text-[12.5px] text-muted-foreground" data-testid="column-filter-summary">
      <span>Showing {shown.toLocaleString("en-IN")} of {total.toLocaleString("en-IN")}{activeCount ? ` · ${activeCount} column filter${activeCount === 1 ? "" : "s"}` : ""}{sorted ? " · sorted" : ""}</span>
      <button type="button" onClick={onClear} className="min-h-8 rounded-md px-2 font-semibold text-signal-teal-ink underline">Clear filters and sort</button>
    </p>
  )
}

function ColumnHeader({ label, name, numeric, values, sortDir, onSort, filter, onFilter }: {
  label: ReactNode; name: string; numeric: boolean; values: string[]; sortDir: "asc" | "desc" | null
  onSort: (dir: "asc" | "desc" | null) => void; filter?: ColumnFilterState; onFilter: (next: ColumnFilterState | null) => void
}) {
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const active = Boolean(filter && (filter.text || filter.picked || filter.min || filter.max))
  const next = sortDir === null ? "asc" : sortDir === "asc" ? "desc" : null
  const words = numeric ? ["low → high", "high → low"] : ["A → Z", "Z → A"]
  return (
    <span className="inline-flex items-center gap-0.5 whitespace-nowrap">
      <button type="button" onClick={() => onSort(next)} className="inline-flex min-h-8 items-center gap-1 rounded px-1 uppercase hover:text-foreground"
        title={`Sort ${name}: ${next === "asc" ? words[0] : next === "desc" ? words[1] : "off"}`} data-testid={`sort-${name}`}>
        <span>{label}</span>
        {sortDir === "asc" ? <ArrowUp className="h-3.5 w-3.5 text-foreground" aria-hidden /> : sortDir === "desc" ? <ArrowDown className="h-3.5 w-3.5 text-foreground" aria-hidden /> : <ArrowUpDown className="h-3 w-3 opacity-50" aria-hidden />}
        <span className="sr-only">{sortDir ? `, sorted ${sortDir === "asc" ? words[0] : words[1]}` : ", not sorted"}</span>
      </button>
      <button ref={button} type="button" onClick={() => setOpen((value) => !value)} aria-haspopup="dialog" aria-expanded={open}
        aria-label={`Filter ${name}${active ? " (filter on)" : ""}`} data-testid={`filter-${name}`}
        className={cn("grid h-7 w-7 place-items-center rounded-md", active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
        <Filter className="h-3.5 w-3.5" aria-hidden />
      </button>
      {open ? <FilterPopover anchor={button.current} name={name} numeric={numeric} values={values} words={words} sortDir={sortDir} onSort={onSort}
        filter={filter} onFilter={onFilter} onClose={() => { setOpen(false); button.current?.focus() }} /> : null}
    </span>
  )
}

function FilterPopover({ anchor, name, numeric, values, words, sortDir, onSort, filter, onFilter, onClose }: {
  anchor: HTMLElement | null; name: string; numeric: boolean; values: string[]; words: string[]; sortDir: "asc" | "desc" | null
  onSort: (dir: "asc" | "desc" | null) => void; filter?: ColumnFilterState; onFilter: (next: ColumnFilterState | null) => void; onClose: () => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState({ top: 0, left: 0 })
  const [search, setSearch] = useState("")
  useLayoutEffect(() => {
    if (!anchor) return
    const rect = anchor.getBoundingClientRect()
    setPlace({ top: rect.bottom + 4, left: Math.max(8, Math.min(rect.left - 8, window.innerWidth - 296)) })
  }, [anchor])
  // The latest onClose without re-running the effect (it would move the focus on every keystroke).
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    box.current?.querySelector<HTMLElement>("input, button")?.focus()
    const onClose = () => close.current()
    const onDown = (event: MouseEvent) => { if (!box.current?.contains(event.target as Node) && !anchor?.contains(event.target as Node)) onClose() }
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose() }
    const onScroll = (event: Event) => { if (!box.current?.contains(event.target as Node)) onClose() }
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    window.addEventListener("scroll", onScroll, true)
    window.addEventListener("resize", onClose)
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); window.removeEventListener("scroll", onScroll, true); window.removeEventListener("resize", onClose) }
  }, [anchor])

  const current = filter || {}
  const picked = current.picked ? new Set(current.picked) : null
  const list = values.filter((value) => !search || value.toLowerCase().includes(search.toLowerCase())).slice(0, 200)
  const toggle = (value: string) => {
    const set = new Set(picked || values)
    if (set.has(value)) set.delete(value); else set.add(value)
    onFilter({ ...current, picked: set.size === values.length ? undefined : Array.from(set) })
  }
  const field = "h-9 w-full rounded-md border border-border bg-card px-2 text-[13px] text-foreground normal-case tracking-normal"
  if (typeof document === "undefined") return null
  return createPortal(
    <div ref={box} role="dialog" aria-label={`Sort and filter ${name}`} style={{ position: "fixed", top: place.top, left: place.left, width: 280 }}
      className="z-[80] rounded-xl border border-border bg-card p-3 text-left text-[13px] font-normal normal-case tracking-normal text-foreground shadow-xl" data-testid="column-filter-popover">
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold">{name}</p>
        <button type="button" onClick={onClose} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-md hover:bg-muted"><X className="h-4 w-4" aria-hidden /></button>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        {(["asc", "desc"] as const).map((dir, index) => (
          <button key={dir} type="button" aria-pressed={sortDir === dir} onClick={() => onSort(sortDir === dir ? null : dir)}
            className={cn("min-h-9 rounded-md border px-2 text-[12.5px] font-semibold", sortDir === dir ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted")}>
            {numeric ? (index ? "High → low" : "Low → high") : words[index]}
          </button>
        ))}
      </div>
      {numeric ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <label className="space-y-1"><span className="block text-[12px] font-semibold text-muted-foreground">Min</span>
            <input type="number" inputMode="decimal" className={field} value={current.min || ""} onChange={(event) => onFilter({ ...current, min: event.target.value || undefined })} /></label>
          <label className="space-y-1"><span className="block text-[12px] font-semibold text-muted-foreground">Max</span>
            <input type="number" inputMode="decimal" className={field} value={current.max || ""} onChange={(event) => onFilter({ ...current, max: event.target.value || undefined })} /></label>
        </div>
      ) : (
        <label className="mt-3 block space-y-1"><span className="block text-[12px] font-semibold text-muted-foreground">Contains</span>
          <input type="search" className={field} value={current.text || ""} onChange={(event) => onFilter({ ...current, text: event.target.value || undefined })} /></label>
      )}
      {values.length > 0 ? (
        <div className="mt-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12px] font-semibold text-muted-foreground">Values ({values.length})</span>
            <button type="button" className="min-h-8 px-1 text-[12px] font-semibold text-signal-teal-ink underline" onClick={() => onFilter({ ...current, picked: picked && picked.size === 0 ? undefined : [] })}>
              {picked && picked.size === 0 ? "Select all" : "Clear all"}
            </button>
          </div>
          {values.length > 8 ? <input type="search" aria-label={`Find a ${name} value`} placeholder="Find a value" className={cn(field, "mt-1")} value={search} onChange={(event) => setSearch(event.target.value)} /> : null}
          <ul className="mt-1 max-h-48 overflow-y-auto rounded-md border border-border">
            {list.map((value) => (
              <li key={value}>
                <label className="flex min-h-8 cursor-pointer items-center gap-2 px-2 hover:bg-muted">
                  <input type="checkbox" className="h-4 w-4 accent-[hsl(var(--primary))]" checked={!picked || picked.has(value)} onChange={() => toggle(value)} />
                  <span className="truncate">{value}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="mt-3 flex justify-between gap-2">
        <button type="button" className="min-h-9 rounded-md border border-border px-3 text-[12.5px] font-semibold hover:bg-muted" onClick={() => { onFilter(null); onSort(null) }}>Clear</button>
        <button type="button" className="min-h-9 rounded-md bg-primary px-3 text-[12.5px] font-semibold text-primary-foreground" onClick={onClose}>Done</button>
      </div>
    </div>,
    document.body,
  )
}
