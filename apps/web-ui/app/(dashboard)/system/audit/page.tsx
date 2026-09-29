"use client"

import Link from "next/link"
import dayjs from "dayjs"
import { useEffect, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import {
  Activity, ArrowUpRight, Boxes, ClipboardList, Copy, Download, Factory, FileText, History, KeyRound, Layers, RefreshCw,
  Search, ShieldCheck, ShoppingCart, User, X,
} from "lucide-react"

import { PageHeader } from "@/components/workspace/page-header"
import { ErrorState } from "@/components/workspace/query-state"
import { RoleGate } from "@/components/workspace/role-gate"
import { useApp } from "@/context/AppContext"
import { useAuth } from "@/context/AuthContext"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"

type AuditEvent = {
  id: string; occurred_at: string; plant_id: string | null; actor_email: string | null; actor_role: string | null
  event_type: string; entity_type: string | null; entity_id: string | null; summary: string | null
  payload: Record<string, any>; ip: string | null; source_service: string | null
}
type Facets = {
  total: number
  source_service: Array<{ value: string; count: number }>
  entity_type: Array<{ value: string; count: number }>
  event_type: Array<{ value: string; count: number }>
  actor_email: Array<{ value: string; count: number }>
  by_day: Array<{ day: string; source_service: string; count: number }>
}

const PERIODS = [
  { hours: 24, label: "24 h" }, { hours: 168, label: "7 days" }, { hours: 720, label: "30 days" }, { hours: 2160, label: "90 days" }, { hours: 8760, label: "1 year" },
]
const MODULE: Record<string, { label: string; icon: any; tone: string }> = {
  "production-service": { label: "Production", icon: Factory, tone: "bg-signal-violet-soft text-signal-violet-ink" },
  "inventory-service": { label: "Stores & purchase", icon: Boxes, tone: "bg-signal-cyan-soft text-signal-cyan-ink" },
  "sales-service": { label: "Sales", icon: ShoppingCart, tone: "bg-signal-blue-soft text-signal-blue-ink" },
  "spec-service": { label: "Specs", icon: FileText, tone: "bg-signal-amber-soft text-signal-amber-ink" },
  "auth-service": { label: "Users & access", icon: KeyRound, tone: "bg-signal-rose-soft text-signal-rose-ink" },
  "masterdata-service": { label: "Masters", icon: Layers, tone: "bg-signal-emerald-soft text-signal-emerald-ink" },
  "bff-api": { label: "Workspace", icon: Activity, tone: "bg-muted text-muted-foreground" },
}
const moduleOf = (service?: string | null) => MODULE[service || ""] || { label: service || "Other", icon: ClipboardList, tone: "bg-muted text-muted-foreground" }
const CHART_COLORS = ["hsl(var(--chart-1))", "hsl(var(--chart-2))", "hsl(var(--chart-3))", "hsl(var(--chart-4))", "hsl(var(--chart-5))", "hsl(var(--chart-6))", "hsl(var(--chart-7))"]

/** Where an audited record lives in the app, when it has its own page. */
function recordHref(entityType?: string | null, entityId?: string | null) {
  if (!entityType || !entityId) return null
  const type = entityType.toLowerCase()
  if (type.startsWith("job_card") && !type.includes("segment") && !type.includes("stage")) return `/production/job-cards/${entityId}`
  if (type.startsWith("sales_order") && !type.includes("line") && !type.includes("lot")) return `/sales-orders/${entityId}`
  if (type.startsWith("purchase_order") && !type.includes("line")) return `/purchase/${entityId}`
  if (type.startsWith("purchase_receipt") || type === "grn") return `/purchase/receipts/${entityId}`
  if (type.startsWith("spec")) return `/specifications/${entityId}`
  return null
}

const asUtc = (value: string) => new Date(value + (/Z$|[+-]\d\d:\d\d$/.test(value) ? "" : "Z"))
const humanize = (value: string) => value.replaceAll("_", " ").replace(/\s+/g, " ").trim()

/** A readable one-liner: the saved summary, else "<record> <action>". */
function titleOf(event: AuditEvent) {
  if (event.summary) return event.summary
  return humanize(event.event_type)
}

/** Before/after pairs found in a payload, for a field-by-field change table. */
function changesOf(payload: Record<string, any>) {
  const before = payload?.before ?? payload?.before_payload ?? payload?.old
  const after = payload?.after ?? payload?.after_payload ?? payload?.new
  if (!before || !after || typeof before !== "object" || typeof after !== "object") return []
  const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]))
  return keys
    .map((key) => ({ key, before: before[key], after: after[key] }))
    .filter((row) => JSON.stringify(row.before) !== JSON.stringify(row.after))
}
const show = (value: any) => (value === null || value === undefined || value === "" ? "—" : typeof value === "object" ? JSON.stringify(value) : String(value))

export default function AuditPage() {
  const { activePlant } = useAuth()
  const { showToast } = useApp()
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [search, setSearch] = useState(params?.get("q") || "")
  const [offset, setOffset] = useState(0)
  const [live, setLive] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const filters = {
    hours: Number(params?.get("hours") || 168),
    source_service: params?.get("module") || "",
    entity_type: params?.get("entity_type") || "",
    entity_id: params?.get("entity_id") || "",
    actor_email: params?.get("actor") || "",
    event_type: params?.get("event") || "",
    q: params?.get("q") || "",
  }
  const setFilter = (patch: Record<string, string | number | null>) => {
    const next = new URLSearchParams(params?.toString())
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === "" || value === undefined) next.delete(key)
      else next.set(key, String(value))
    }
    setOffset(0)
    router.replace(`${pathname}?${next.toString()}`, { scroll: false })
  }
  useEffect(() => {
    const timer = setTimeout(() => { if (search !== filters.q) setFilter({ q: search || null }) }, 350)
    return () => clearTimeout(timer)
  }, [search]) // eslint-disable-line react-hooks/exhaustive-deps

  const query = {
    since_hours: filters.hours,
    ...(filters.source_service ? { source_service: filters.source_service } : {}),
    ...(filters.entity_type ? { entity_type: filters.entity_type } : {}),
    ...(filters.entity_id ? { entity_id: filters.entity_id } : {}),
    ...(filters.actor_email ? { actor_email: filters.actor_email } : {}),
    ...(filters.event_type ? { event_type: filters.event_type } : {}),
    ...(filters.q ? { q: filters.q } : {}),
    ...(activePlant && activePlant !== "ALL" ? { plant_id: activePlant } : {}),
  }
  const events = useQuery({
    queryKey: ["audit-events", query, offset],
    queryFn: async () => (await api.get("/api/auth/audit-events", { params: { ...query, limit: 100, offset } })).data as { items: AuditEvent[]; total_count: number; has_more: boolean },
    refetchInterval: live ? 30000 : false,
    placeholderData: (previous) => previous,
  })
  const facets = useQuery({
    queryKey: ["audit-facets", query],
    queryFn: async () => (await api.get("/api/auth/audit-events/facets", { params: query })).data as Facets,
    refetchInterval: live ? 30000 : false,
  })
  const items = useMemo(() => events.data?.items || [], [events.data])
  const selected = items.find((event) => event.id === selectedId) || null
  const grouped = useMemo(() => {
    const map = new Map<string, AuditEvent[]>()
    for (const event of items) {
      const key = dayjs(asUtc(event.occurred_at)).format("YYYY-MM-DD")
      map.set(key, [...(map.get(key) || []), event])
    }
    return Array.from(map.entries())
  }, [items])

  const chart = useMemo(() => {
    const rows = facets.data?.by_day || []
    const services = Array.from(new Set(rows.map((row) => row.source_service)))
    const days = Array.from(new Set(rows.map((row) => row.day))).sort()
    const max = Math.max(1, ...days.map((day) => rows.filter((row) => row.day === day).reduce((sum, row) => sum + row.count, 0)))
    return { services, days, max, rows }
  }, [facets.data])

  const activeChips = [
    filters.source_service && { key: "module", label: `Module: ${moduleOf(filters.source_service).label}` },
    filters.entity_type && { key: "entity_type", label: `Record: ${humanize(filters.entity_type)}` },
    filters.entity_id && { key: "entity_id", label: `One record: ${filters.entity_id.slice(0, 12)}` },
    filters.actor_email && { key: "actor", label: `By: ${filters.actor_email}` },
    filters.event_type && { key: "event", label: `Event: ${humanize(filters.event_type)}` },
    filters.q && { key: "q", label: `“${filters.q}”` },
  ].filter(Boolean) as Array<{ key: string; label: string }>

  const exportCsv = async () => {
    try {
      const rows: AuditEvent[] = []
      for (let page = 0; page < 20; page += 1) {
        const { data } = await api.get("/api/auth/audit-events", { params: { ...query, limit: 500, offset: page * 500 } })
        rows.push(...(data.items || []))
        if (!data.has_more) break
      }
      const header = ["When", "Module", "Event", "Summary", "Record type", "Record id", "By", "Role", "Plant", "IP"]
      const lines = [header, ...rows.map((row) => [asUtc(row.occurred_at).toISOString(), moduleOf(row.source_service).label, row.event_type, row.summary || "", row.entity_type || "", row.entity_id || "", row.actor_email || "system", row.actor_role || "", row.plant_id || "", row.ip || ""])]
      const blob = new Blob([lines.map((line) => line.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n")], { type: "text/csv" })
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = `audit-${dayjs().format("YYYYMMDD-HHmm")}.csv`
      link.click()
      URL.revokeObjectURL(url)
      showToast(`${rows.length} events exported.`, "success")
    } catch {
      showToast("Export failed — try a shorter period.", "error")
    }
  }

  const facetSelect = (label: string, key: string, value: string, options: Array<{ value: string; count: number }>, render: (value: string) => string = humanize) => (
    <label className="grid gap-0.5 text-[11px] text-muted-foreground">
      {label}
      <select value={value} onChange={(event) => setFilter({ [key]: event.target.value || null })} className="h-9 min-w-[150px] max-w-[220px] rounded-lg border border-input bg-card px-2 text-[12.5px] text-foreground">
        <option value="">All</option>
        {value && !options.some((option) => option.value === value) ? <option value={value}>{render(value)}</option> : null}
        {options.map((option) => <option key={option.value} value={option.value}>{render(option.value)} · {option.count}</option>)}
      </select>
    </label>
  )

  return (
    <RoleGate allow={["Owner", "Admin"]} fallbackMessage="Only Owner and Admin can view the system audit workspace.">
      <main className="space-y-4" data-testid="audit-page">
        <PageHeader
          eyebrow="Governance"
          title="System audit history"
          description="Every recorded change across sales, planning, production, stores, purchase, specs and access — who did it, when, to which record, and what changed."
          actions={
            <>
              <label className="inline-flex items-center gap-2 text-[12.5px] text-muted-foreground"><input type="checkbox" checked={live} onChange={(event) => setLive(event.target.checked)} />Live (30 s)</label>
              <button type="button" className="erp-btn-secondary" onClick={() => { void events.refetch(); void facets.refetch() }} disabled={events.isFetching}><RefreshCw className={cn("h-4 w-4", events.isFetching && "animate-spin")} />Refresh</button>
              <button type="button" className="erp-btn-secondary" onClick={() => void exportCsv()}><Download className="h-4 w-4" />Export CSV</button>
            </>
          }
        />

        <section className="grid gap-3 rounded-xl border border-border bg-card p-3 shadow-sm lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ["Events", facets.data?.total ?? events.data?.total_count, History],
              ["People", facets.data?.actor_email.length, User],
              ["Modules", facets.data?.source_service.length, Activity],
              ["Record types", facets.data?.entity_type.length, ClipboardList],
            ].map(([label, value, Icon]: any) => (
              <div key={label} className="rounded-lg bg-[hsl(var(--surface-2))] px-3 py-2">
                <p className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground"><Icon className="h-3.5 w-3.5" />{label}</p>
                <p className="text-[20px] font-semibold tabular-nums">{value === undefined ? "—" : Number(value).toLocaleString("en-IN")}</p>
              </div>
            ))}
          </div>
          <div className="min-w-0" aria-label="Activity by day">
            <div className="flex h-[72px] items-end gap-[3px]">
              {chart.days.map((day) => {
                const rows = chart.rows.filter((row) => row.day === day)
                const total = rows.reduce((sum, row) => sum + row.count, 0)
                return (
                  <div key={day} title={`${dayjs(day).format("ddd DD MMM")}: ${total} events`} className="group flex min-w-[4px] flex-1 flex-col-reverse overflow-hidden rounded-sm" style={{ height: `${(total / chart.max) * 100}%` }}>
                    {rows.map((row) => <span key={row.source_service} className="block w-full transition-opacity group-hover:opacity-80" style={{ height: `${(row.count / total) * 100}%`, background: CHART_COLORS[chart.services.indexOf(row.source_service) % CHART_COLORS.length] }} />)}
                  </div>
                )
              })}
              {!chart.days.length ? <p className="self-center text-[12px] text-muted-foreground">{facets.isLoading ? "Loading activity…" : "No activity in this period."}</p> : null}
            </div>
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
              {chart.services.map((service, index) => (
                <button key={service} type="button" onClick={() => setFilter({ module: filters.source_service === service ? null : service })} className={cn("inline-flex items-center gap-1 hover:text-foreground", filters.source_service === service && "font-semibold text-foreground")}>
                  <span className="h-2 w-2 rounded-sm" style={{ background: CHART_COLORS[index % CHART_COLORS.length] }} />{moduleOf(service).label}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="sticky top-0 z-20 space-y-2 rounded-xl border border-border bg-card/95 p-3 shadow-sm backdrop-blur" aria-label="Filters">
          <div className="flex flex-wrap items-end gap-2">
            <div className="tube-segment !h-9" role="group" aria-label="Period">
              {PERIODS.map((period) => <button key={period.hours} type="button" aria-pressed={filters.hours === period.hours} onClick={() => setFilter({ hours: period.hours === 168 ? null : period.hours })}>{period.label}</button>)}
            </div>
            <label className="flex h-9 min-w-[240px] flex-1 items-center gap-2 rounded-lg border border-input bg-card px-2.5 focus-within:ring-2 focus-within:ring-ring/30">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input aria-label="Search audit" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search summary, record no / id, event, person, details…" className="w-full bg-transparent text-[13px] outline-none" />
              {search ? <button type="button" aria-label="Clear search" onClick={() => setSearch("")}><X className="h-3.5 w-3.5 text-muted-foreground" /></button> : null}
            </label>
            {facetSelect("Module", "module", filters.source_service, facets.data?.source_service || [], (value) => moduleOf(value).label)}
            {facetSelect("Record type", "entity_type", filters.entity_type, facets.data?.entity_type || [])}
            {facetSelect("Event", "event", filters.event_type, facets.data?.event_type || [])}
            {facetSelect("Person", "actor", filters.actor_email, facets.data?.actor_email || [], (value) => value)}
          </div>
          {activeChips.length ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {activeChips.map((chip) => (
                <button key={chip.key} type="button" onClick={() => { if (chip.key === "q") setSearch(""); setFilter({ [chip.key]: null }) }} className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[11.5px] font-semibold text-primary">
                  {chip.label}<X className="h-3 w-3" />
                </button>
              ))}
              <button type="button" onClick={() => { setSearch(""); router.replace(pathname || "/system/audit", { scroll: false }) }} className="text-[11.5px] font-semibold text-muted-foreground hover:text-foreground">Clear all</button>
            </div>
          ) : null}
        </section>

        {events.isError ? <ErrorState message="The audit log could not be loaded. Refresh to retry." onRetry={() => { void events.refetch() }} /> : null}

        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_440px]">
          <section className="min-w-0 rounded-xl border border-border bg-card shadow-sm" aria-label="Events">
            <div className="flex items-center justify-between border-b border-border px-4 py-2 text-[12px] text-muted-foreground">
              <span>{events.data ? `${events.data.total_count.toLocaleString("en-IN")} events · showing ${offset + 1}–${offset + items.length}` : "Loading…"}</span>
              <span>Updated {events.dataUpdatedAt ? dayjs(events.dataUpdatedAt).format("HH:mm:ss") : "—"}</span>
            </div>
            {events.isLoading ? (
              <div className="space-y-2 p-4">{Array.from({ length: 8 }, (_, index) => <div key={index} className="skeleton h-12 rounded-lg" />)}</div>
            ) : !items.length ? (
              <p className="px-4 py-12 text-center text-[13px] text-muted-foreground">No recorded events match these filters. Widen the period or clear a filter.</p>
            ) : (
              <ol>
                {grouped.map(([day, dayEvents]) => (
                  <li key={day}>
                    <p className="sticky top-[120px] z-10 border-b border-border bg-[hsl(var(--surface-2))] px-4 py-1 text-[11.5px] font-semibold text-muted-foreground">{dayjs(day).format("dddd, D MMMM YYYY")} · {dayEvents.length}</p>
                    <ul>
                      {dayEvents.map((event) => {
                        const mod = moduleOf(event.source_service)
                        const Icon = mod.icon
                        const active = event.id === selectedId
                        const changes = changesOf(event.payload)
                        return (
                          <li key={event.id}>
                            <button type="button" onClick={() => setSelectedId(active ? null : event.id)} aria-pressed={active}
                              className={cn("flex w-full items-start gap-3 border-b border-border px-4 py-2.5 text-left transition-colors", active ? "bg-primary/[.06]" : "hover:bg-muted/50")}>
                              <span className={cn("mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg", mod.tone)}><Icon className="h-3.5 w-3.5" /></span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[13px] font-medium">{titleOf(event)}</span>
                                <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11.5px] text-muted-foreground">
                                  <span>{event.actor_email || "System"}</span>
                                  {event.entity_type ? <span>· {humanize(event.entity_type)}</span> : null}
                                  {changes.length ? <span className="text-signal-amber-ink">· {changes.length} field{changes.length === 1 ? "" : "s"} changed</span> : null}
                                </span>
                              </span>
                              <span className="shrink-0 text-right text-[11.5px] tabular-nums text-muted-foreground">
                                {dayjs(asUtc(event.occurred_at)).format("HH:mm:ss")}
                                <span className="block">{mod.label}</span>
                              </span>
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  </li>
                ))}
              </ol>
            )}
            <div className="flex items-center justify-between px-4 py-2.5">
              <button type="button" className="erp-btn-secondary !h-8" disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 100))}>Newer</button>
              <span className="text-[12px] text-muted-foreground">Page {offset / 100 + 1}</span>
              <button type="button" className="erp-btn-secondary !h-8" disabled={!events.data?.has_more} onClick={() => setOffset(offset + 100)}>Older</button>
            </div>
          </section>

          <aside className="min-w-0 rounded-xl border border-border bg-card shadow-sm xl:sticky xl:top-[132px] xl:max-h-[calc(100dvh-150px)] xl:overflow-y-auto" aria-label="Event detail" data-testid="audit-detail">
            {selected ? <EventDetail event={selected} onFilter={setFilter} onClose={() => setSelectedId(null)} /> : (
              <div className="p-6 text-center text-[13px] text-muted-foreground">
                <ShieldCheck className="mx-auto mb-2 h-6 w-6 text-primary" />
                Select an event to see who did it, what changed field by field, and to jump to the record or everything that happened to it.
              </div>
            )}
          </aside>
        </div>
      </main>
    </RoleGate>
  )
}

function EventDetail({ event, onFilter, onClose }: { event: AuditEvent; onFilter: (patch: Record<string, string | null>) => void; onClose: () => void }) {
  const { showToast } = useApp()
  const mod = moduleOf(event.source_service)
  const changes = changesOf(event.payload)
  const href = recordHref(event.entity_type, event.entity_id)
  const rest = Object.entries(event.payload || {}).filter(([key]) => !["before", "after", "before_payload", "after_payload", "old", "new"].includes(key))
  return (
    <div className="animate-scale-in">
      <div className="flex items-start gap-2 border-b border-border p-4">
        <div className="min-w-0 flex-1">
          <p className="text-[11.5px] font-semibold text-muted-foreground">{mod.label} · {humanize(event.event_type)}</p>
          <h2 className="mt-0.5 text-[15px] font-semibold leading-snug">{titleOf(event)}</h2>
          <p className="mt-1 text-[12px] text-muted-foreground">{dayjs(asUtc(event.occurred_at)).format("dddd, D MMM YYYY · HH:mm:ss")}</p>
        </div>
        <button type="button" aria-label="Close detail" onClick={onClose} className="tube-icon-button !h-8 !w-8"><X className="h-4 w-4" /></button>
      </div>
      <dl className="grid grid-cols-[100px_minmax(0,1fr)] gap-x-3 gap-y-1.5 p-4 text-[12.5px]">
        <dt className="text-muted-foreground">By</dt>
        <dd className="min-w-0">
          <span className="font-medium">{event.actor_email || "System"}</span>{event.actor_role ? <span className="text-muted-foreground"> · {event.actor_role}</span> : null}
          {event.actor_email ? <button type="button" onClick={() => onFilter({ actor: event.actor_email })} className="ml-2 text-[11.5px] font-semibold text-primary hover:underline">all by them</button> : null}
        </dd>
        <dt className="text-muted-foreground">Record</dt>
        <dd className="min-w-0">
          <span className="font-medium">{event.entity_type ? humanize(event.entity_type) : "—"}</span>
          {event.entity_id ? <span className="block truncate font-mono text-[11.5px] text-muted-foreground" title={event.entity_id}>{event.entity_id}</span> : null}
          <span className="mt-1 flex flex-wrap gap-2">
            {href ? <Link href={href} className="inline-flex items-center gap-0.5 text-[11.5px] font-semibold text-primary hover:underline">Open record<ArrowUpRight className="h-3 w-3" /></Link> : null}
            {event.entity_id ? <button type="button" onClick={() => onFilter({ entity_id: event.entity_id, entity_type: event.entity_type })} className="text-[11.5px] font-semibold text-primary hover:underline">Full history of this record</button> : null}
          </span>
        </dd>
        <dt className="text-muted-foreground">Plant</dt><dd>{event.plant_id || "Account-wide"}</dd>
        <dt className="text-muted-foreground">Source</dt><dd>{event.source_service || "—"}{event.ip ? ` · ${event.ip}` : ""}</dd>
      </dl>
      {changes.length ? (
        <div className="border-t border-border p-4">
          <p className="text-[12px] font-semibold">What changed</p>
          <table className="mt-2 w-full text-[12px]">
            <thead className="text-left text-[11px] text-muted-foreground"><tr><th className="py-1 font-semibold">Field</th><th className="py-1 font-semibold">Before</th><th className="py-1 font-semibold">After</th></tr></thead>
            <tbody>
              {changes.map((row) => (
                <tr key={row.key} className="border-t border-border align-top">
                  <td className="py-1 pr-2 font-medium">{humanize(row.key)}</td>
                  <td className="break-all py-1 pr-2 text-signal-rose-ink line-through decoration-signal-rose-ink/40">{show(row.before)}</td>
                  <td className="break-all py-1 font-semibold text-signal-emerald-ink">{show(row.after)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {rest.length ? (
        <div className="border-t border-border p-4">
          <div className="flex items-center justify-between">
            <p className="text-[12px] font-semibold">Details</p>
            <button type="button" onClick={() => { void navigator.clipboard?.writeText(JSON.stringify(event, null, 2)); showToast("Event copied as JSON.", "success") }} className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-muted-foreground hover:text-foreground"><Copy className="h-3 w-3" />Copy JSON</button>
          </div>
          <dl className="mt-2 grid grid-cols-[120px_minmax(0,1fr)] gap-x-3 gap-y-1 text-[12px]">
            {rest.map(([key, value]) => (
              <div key={key} className="contents">
                <dt className="truncate text-muted-foreground" title={key}>{humanize(key)}</dt>
                <dd className="min-w-0 break-words">{typeof value === "object" && value !== null ? <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-muted p-1.5 text-[11px]">{JSON.stringify(value, null, 2)}</pre> : show(value)}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
      <p className="border-t border-border px-4 py-2 font-mono text-[10.5px] text-muted-foreground">Event {event.id}</p>
    </div>
  )
}
