"use client"

import Link from "next/link"
import { ArrowRight, Ban, CalendarCheck2, CheckCircle2, CircleSlash2, ClipboardCheck, Download, Factory, Flag, History, PauseCircle, Pencil, Rocket, Scissors, Search, ShieldCheck, Truck, Undo2 } from "lucide-react"
import { useMemo, useState } from "react"

import { Chip } from "@/components/sales/order-chips"
import type { OrderHistory, OrderHistoryEvent } from "@/hooks/use-sales"
import { eventDay, formatDateTime, formatShortDate, serverTime } from "@/lib/sales-order-tracker"
import { plantToday } from "@/lib/due-risk"
import { cn } from "@/lib/utils"

export const HISTORY_KIND: Record<string, { label: string; icon: any; tone: string }> = {
  ORDER: { label: "Order", icon: ClipboardCheck, tone: "bg-primary/10 text-primary" },
  RELEASE: { label: "Release", icon: Rocket, tone: "bg-signal-violet-soft text-signal-violet-ink" },
  PLAN: { label: "Plan", icon: CalendarCheck2, tone: "bg-signal-blue-soft text-signal-blue-ink" },
  RUN: { label: "Runs", icon: Factory, tone: "bg-signal-blue-soft text-signal-blue-ink" },
  RUN_EDIT: { label: "Run changed", icon: Pencil, tone: "bg-signal-amber-soft text-signal-amber-ink" },
  RUN_VOID: { label: "Run voided", icon: Undo2, tone: "bg-signal-rose-soft text-signal-rose-ink" },
  QC: { label: "QC", icon: ShieldCheck, tone: "bg-signal-emerald-soft text-signal-emerald-ink" },
  QC_FLAG: { label: "Flagged QC", icon: Flag, tone: "bg-signal-amber-soft text-signal-amber-ink" },
  HOLD: { label: "Holds", icon: PauseCircle, tone: "bg-signal-rose-soft text-signal-rose-ink" },
  STAGE_CLOSE: { label: "Stage closed", icon: CheckCircle2, tone: "bg-signal-emerald-soft text-signal-emerald-ink" },
  STAGE_REOPEN: { label: "Stage reopened", icon: Undo2, tone: "bg-signal-amber-soft text-signal-amber-ink" },
  SPLIT: { label: "Split", icon: Scissors, tone: "bg-signal-violet-soft text-signal-violet-ink" },
  EDIT: { label: "Edits", icon: Pencil, tone: "bg-signal-amber-soft text-signal-amber-ink" },
  FORCE_CLOSE: { label: "Force close", icon: CircleSlash2, tone: "bg-signal-rose-soft text-signal-rose-ink" },
  DISPATCH: { label: "Dispatch", icon: Truck, tone: "bg-signal-emerald-soft text-signal-emerald-ink" },
  CLOSE: { label: "Cancel / short close", icon: Ban, tone: "bg-signal-rose-soft text-signal-rose-ink" },
  OTHER: { label: "Other", icon: History, tone: "bg-muted text-muted-foreground" },
}

const KIND_ORDER = Object.keys(HISTORY_KIND)

function plain(value: unknown): string {
  if (value == null || value === "") return "—"
  if (typeof value === "number") return value.toLocaleString("en-IN")
  if (typeof value === "boolean") return value ? "yes" : "no"
  if (typeof value === "string") return value.replace("SHIFT_", "Shift ")
  if (Array.isArray(value)) return value.map(plain).join(", ")
  return JSON.stringify(value)
}

const HIDE_KEYS = new Set(["order_no", "status", "origin"])
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Technical keys (ids, references) nobody needs to read on a timeline. */
const technical = (key: string, value: unknown) => /(^|_)(id|ids|ref|key)$/i.test(key) || (typeof value === "string" && UUID_RE.test(value))

/** before → after pairs worth reading: keys that changed, or the "after" facts when there is no before. */
function changes(event: OrderHistoryEvent): Array<{ key: string; before: unknown; after: unknown }> {
  const before = event.before && typeof event.before === "object" ? event.before : null
  const after = event.after && typeof event.after === "object" ? event.after : null
  if (!before && !after) return []
  const keys = Array.from(new Set([...Object.keys(before || {}), ...Object.keys(after || {})])).filter((key) => !HIDE_KEYS.has(key))
  return keys
    .map((key) => ({ key, before: before ? before[key] : undefined, after: after ? after[key] : undefined }))
    .filter((row) => !technical(row.key, row.after ?? row.before))
    .filter((row) => (before ? JSON.stringify(row.before) !== JSON.stringify(row.after) : row.after != null && row.after !== "" && typeof row.after !== "object"))
    .slice(0, 8)
}

function dayLabel(day: string, today: string) {
  if (!day) return "Unknown date"
  const yesterday = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10) - 1)).toISOString().slice(0, 10)
  if (day === today) return `Today · ${formatShortDate(day)}`
  if (day === yesterday) return `Yesterday · ${formatShortDate(day)}`
  return formatShortDate(day, today)
}

/**
 * One timeline for an order: sales + production events (release, plan, runs, QC with flags, holds,
 * stage closes, splits, edits, dispatch), newest first, with who, when, before → after. Filter chips
 * by kind and source, search, flagged events highlighted, export to Excel.
 */
export function OrderHistoryTimeline({ history, loading, error, onRetry, orderNo, cardHref = (id) => `/production/job-cards/${id}`, onOpenCard, pageSize = 60 }: {
  history?: OrderHistory | null
  loading?: boolean
  error?: boolean
  onRetry?: () => void
  orderNo?: string | null
  cardHref?: (jobCardId: string) => string
  onOpenCard?: (jobCardId: string) => void
  pageSize?: number
}) {
  const [kind, setKind] = useState<string>("all")
  const [source, setSource] = useState<"all" | "SALES" | "PRODUCTION">("all")
  const [flaggedOnly, setFlaggedOnly] = useState(false)
  const [query, setQuery] = useState("")
  const [limit, setLimit] = useState(pageSize)
  const [exporting, setExporting] = useState(false)
  const today = plantToday()
  const events = useMemo(() => (Array.isArray(history?.events) ? history!.events : []), [history])
  const counts = useMemo(() => {
    const byKind: Record<string, number> = {}
    for (const event of events) byKind[event.kind || "OTHER"] = (byKind[event.kind || "OTHER"] || 0) + 1
    return byKind
  }, [events])
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return events.filter((event) => {
      if (kind !== "all" && (event.kind || "OTHER") !== kind) return false
      if (source !== "all" && event.source !== source) return false
      if (flaggedOnly && !event.flag) return false
      if (needle && ![event.title, event.detail, event.actor, event.role, event.job_card_no, event.stage_label].filter(Boolean).join(" ").toLowerCase().includes(needle)) return false
      return true
    })
  }, [events, kind, source, flaggedOnly, query])
  const sales = events.filter((event) => event.source === "SALES").length
  const production = events.length - sales

  const exportRows = async () => {
    setExporting(true)
    try {
      const ExcelJS = await import("exceljs")
      const workbook = new ExcelJS.Workbook()
      const sheet = workbook.addWorksheet("History")
      sheet.addRow(["When", "Source", "Kind", "Title", "Detail", "Stage", "Job card", "Who", "Role", "Flagged", "Before", "After"])
      for (const event of filtered) {
        sheet.addRow([
          formatDateTime(event.at, true), event.source, HISTORY_KIND[event.kind]?.label || event.kind, event.title || "", event.detail || "", event.stage_label || "", event.job_card_no || "",
          event.actor || "", event.role || "", event.flag ? "yes" : "", event.before ? JSON.stringify(event.before) : "", event.after ? JSON.stringify(event.after) : "",
        ])
      }
      sheet.getRow(1).font = { bold: true }
      sheet.views = [{ state: "frozen", ySplit: 1 }]
      sheet.columns.forEach((column, index) => { column.width = index === 3 || index === 4 ? 44 : 16 })
      const blob = new Blob([await workbook.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = `order-history-${String(orderNo || history?.order_no || "order").replaceAll("/", "-")}-${today}.xlsx`
      link.click()
      URL.revokeObjectURL(url)
    } finally {
      setExporting(false)
    }
  }

  let lastDay = ""
  return (
    <section className="erp-panel min-w-0 overflow-hidden rounded-xl" data-testid="order-history" aria-label="Order history">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2.5 sm:px-4">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-[14px] font-semibold"><History className="h-4 w-4 text-primary" />History</h2>
          <p className="text-[12px] text-muted-foreground">One timeline: order, release, plan, runs, QC, holds, closes, dispatch — who, when, before → after.</p>
        </div>
        <label className="ml-auto flex h-8 min-w-[180px] items-center gap-1.5 rounded-lg border border-border bg-card px-2 text-[12.5px] focus-within:border-ring/70">
          <Search className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          <span className="sr-only">Search history</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search history" className="h-full min-w-0 flex-1 bg-transparent outline-none" data-testid="order-history:search" />
        </label>
        <button type="button" className="erp-btn-secondary !h-8" onClick={() => void exportRows()} disabled={!filtered.length || exporting} data-testid="order-history:export"><Download className="h-3.5 w-3.5" />{exporting ? "Exporting…" : "Export"}</button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-[hsl(var(--surface-2))] px-3 py-2 sm:px-4" role="group" aria-label="History filters">
        <FilterChip active={kind === "all"} onClick={() => setKind("all")}>All <b>{events.length}</b></FilterChip>
        {KIND_ORDER.filter((key) => counts[key]).map((key) => {
          const meta = HISTORY_KIND[key]
          const Icon = meta.icon
          return <FilterChip key={key} active={kind === key} onClick={() => setKind(kind === key ? "all" : key)} flagged={key === "QC_FLAG"}><Icon className="h-3 w-3" aria-hidden="true" />{meta.label} <b>{counts[key]}</b></FilterChip>
        })}
        <span className="mx-1 hidden h-4 w-px bg-border sm:block" aria-hidden="true" />
        <div className="tube-segment !h-7" role="group" aria-label="Source">
          <button type="button" aria-pressed={source === "all"} onClick={() => setSource("all")}>Both</button>
          <button type="button" aria-pressed={source === "SALES"} onClick={() => setSource("SALES")}>Sales {sales}</button>
          <button type="button" aria-pressed={source === "PRODUCTION"} onClick={() => setSource("PRODUCTION")}>Production {production}</button>
        </div>
        <FilterChip active={flaggedOnly} onClick={() => setFlaggedOnly((value) => !value)} flagged><Flag className="h-3 w-3" aria-hidden="true" />Flagged only{history?.summary?.flags ? <b>{history.summary.flags}</b> : null}</FilterChip>
      </div>
      {history?.warnings?.length ? <p role="status" className="border-b border-signal-amber-line bg-signal-amber-soft px-4 py-2 text-[12.5px] text-signal-amber-ink">{history.warnings.join(" ")}</p> : null}
      <div className="px-3 py-3 sm:px-4">
        {loading ? <p className="text-[13px] text-muted-foreground">Loading history…</p> : error ? (
          <p role="alert" className="text-[13px] text-signal-rose-ink">History did not load. {onRetry ? <button type="button" className="font-semibold underline" onClick={onRetry}>Try again</button> : null}</p>
        ) : !filtered.length ? (
          <p className="text-[13px] text-muted-foreground">{events.length ? "Nothing matches these filters." : "No events yet."}</p>
        ) : (
          <ol className="space-y-1" data-testid="order-history:list">
            {filtered.slice(0, limit).map((event) => {
              const day = eventDay(event.at)
              const header = day !== lastDay
              lastDay = day
              const meta = HISTORY_KIND[event.kind] || HISTORY_KIND.OTHER
              const Icon = event.flag ? Flag : meta.icon
              const diff = changes(event)
              const time = serverTime(event.at)?.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }) || "—"
              return (
                <li key={event.id} className="min-w-0">
                  {header ? <p className="mb-1 mt-3 text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground first:mt-0">{dayLabel(day, today)}</p> : null}
                  <div className={cn("grid grid-cols-[44px_28px_minmax(0,1fr)] gap-x-2 rounded-lg px-1.5 py-1.5", event.flag && "border border-signal-amber-line bg-signal-amber-soft/50")} data-testid={event.flag ? "order-history:flagged" : undefined}>
                    <span className="pt-1 text-[11.5px] tabular-nums text-muted-foreground">{time}</span>
                    <span className={cn("mt-0.5 grid h-6 w-6 place-items-center rounded-full", event.flag ? "bg-signal-amber-soft text-signal-amber-ink ring-1 ring-inset ring-signal-amber-line" : meta.tone)}><Icon className="h-3 w-3" aria-hidden="true" /></span>
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[13px] font-medium">
                        <span>{event.title || meta.label}</span>
                        {event.flag ? <Chip tone="amber" icon={Flag} size="xs">Flagged</Chip> : null}
                        <Chip tone={event.source === "SALES" ? "violet" : "blue"} size="xs">{event.source === "SALES" ? "Sales" : "Production"}</Chip>
                        {event.stage_label ? <Chip size="xs">{event.stage_label}</Chip> : null}
                        {event.job_card_id ? (
                          onOpenCard ? <button type="button" onClick={() => onOpenCard(String(event.job_card_id))} className="font-mono text-[12px] font-semibold text-primary hover:underline">{event.job_card_no || "job card"}</button>
                            : <Link href={cardHref(String(event.job_card_id))} className="font-mono text-[12px] font-semibold text-primary hover:underline">{event.job_card_no || "job card"}</Link>
                        ) : null}
                      </p>
                      {event.detail ? <p className="text-[12.5px] text-muted-foreground">{event.detail}</p> : null}
                      {diff.length ? (
                        <dl className="mt-1 grid gap-0.5 text-[12px]">
                          {diff.map((row) => (
                            <div key={row.key} className="flex flex-wrap items-center gap-1.5">
                              <dt className="text-muted-foreground">{row.key.replaceAll("_", " ")}</dt>
                              <dd className="flex items-center gap-1 tabular-nums">
                                {event.before ? <><span className="rounded bg-muted px-1 line-through decoration-muted-foreground/60">{plain(row.before)}</span><ArrowRight className="h-3 w-3 text-muted-foreground" aria-hidden="true" /></> : null}
                                <span className="rounded bg-signal-emerald-soft px-1 font-medium text-signal-emerald-ink">{plain(row.after)}</span>
                              </dd>
                            </div>
                          ))}
                        </dl>
                      ) : null}
                      <p className="text-[11.5px] text-muted-foreground">{event.actor || "system"}{event.role ? ` · ${event.role}` : ""}</p>
                    </div>
                  </div>
                </li>
              )
            })}
          </ol>
        )}
        {filtered.length > limit ? <button type="button" onClick={() => setLimit((value) => value + pageSize)} className="mt-2 text-[12.5px] font-semibold text-primary hover:underline">Show {Math.min(pageSize, filtered.length - limit)} more</button> : null}
      </div>
    </section>
  )
}

function FilterChip({ active, onClick, children, flagged }: { active: boolean; onClick: () => void; children: React.ReactNode; flagged?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-[12px] font-medium transition-colors [&_b]:rounded [&_b]:bg-foreground/[.07] [&_b]:px-1 [&_b]:text-[11px] [&_b]:font-semibold",
        active ? (flagged ? "border-signal-amber-line bg-signal-amber-soft text-signal-amber-ink" : "border-primary bg-primary text-primary-foreground [&_b]:bg-primary-foreground/20") : "border-border bg-card text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  )
}
