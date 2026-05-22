"use client"

import Link from "next/link"
import { useDeferredValue, useMemo, useState } from "react"
import {
  Activity,
  AlertTriangle,
  Bell,
  Database,
  Download,
  Factory,
  Pause,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Truck,
  Users,
  Workflow,
  type LucideIcon,
} from "lucide-react"

import { ExecutiveHero, StatusBadge } from "@/components/erp/shell"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/context/AuthContext"
import { useNotifications } from "@/hooks/use-workspace"
import { usePlanningJobCards } from "@/hooks/use-production"
import { useInventoryTransactions } from "@/hooks/use-inventory"
import { useReadyJobs } from "@/hooks/use-dispatch"
import { useSalesOrders } from "@/hooks/use-sales"
import { useUsers } from "@/hooks/use-system"
import { cn } from "@/lib/utils"

import { AuditOverview } from "@/components/system/audit/audit-overview"
import {
  AuditFeed,
  AuditNotifications,
  AuditStreamTab,
  AuditUsers,
} from "@/components/system/audit/audit-tabs"
import { EventDetailDialog } from "@/components/system/audit/event-detail-dialog"
import {
  RANGE_OPTIONS,
  STREAMS,
  bucketBySeverity,
  downloadCsv,
  eventBlob,
  eventsFromDispatch,
  eventsFromJobCards,
  eventsFromNotifications,
  eventsFromSalesOrders,
  eventsFromTransactions,
  eventsFromUsers,
  formatNumber,
  parseTimestamp,
  rangeStart,
  relativeTime,
  type AuditEvent,
  type AuditStream,
  type DateRange,
  type Severity,
} from "@/components/system/audit/audit-shared"

type TabKey =
  | "overview"
  | "feed"
  | "users"
  | "notifications"
  | "lifecycle"
  | "inventory"

const TAB_LIST: Array<{ key: TabKey; label: string; icon: LucideIcon }> = [
  { key: "overview", label: "Overview", icon: Sparkles },
  { key: "feed", label: "Activity Feed", icon: Workflow },
  { key: "users", label: "Users & Access", icon: Users },
  { key: "notifications", label: "Notifications", icon: Bell },
  { key: "lifecycle", label: "Sales & Production", icon: Factory },
  { key: "inventory", label: "Inventory & Stock", icon: Database },
]

export default function AuditCenterPage() {
  const { user, activeRole } = useAuth()
  const roles = new Set([user?.role, activeRole, ...(user?.roles || [])].filter(Boolean) as string[])
  const canAccess = roles.has("Owner") || roles.has("Admin")

  /* ------ all signal sources ------ */
  const { data: salesOrders, refetch: refetchSales } = useSalesOrders()
  const { data: jobCards, refetch: refetchJobs } = usePlanningJobCards()
  const { data: transactions, refetch: refetchTxns } = useInventoryTransactions()
  const { data: readyJobs, refetch: refetchDispatch } = useReadyJobs()
  const { data: notifications, refetch: refetchNotifs } = useNotifications(canAccess)
  const { data: usersData, refetch: refetchUsers } = useUsers()

  /* ------ filter state ------ */
  const [tab, setTab] = useState<TabKey>("overview")
  const [query, setQuery] = useState("")
  const [stream, setStream] = useState<AuditStream | "all">("all")
  const [range, setRange] = useState<DateRange>("7d")
  const [actor, setActor] = useState("ALL")
  const [severity, setSeverity] = useState<Severity | "ALL">("ALL")
  const [liveTail, setLiveTail] = useState(true)
  const [selectedEvent, setSelectedEvent] = useState<AuditEvent | null>(null)
  const deferredQuery = useDeferredValue(query.trim())

  /* ------ event synthesis ------ */
  const events: AuditEvent[] = useMemo(() => {
    const notifItems = Array.isArray(notifications?.items)
      ? notifications.items
      : Array.isArray(notifications)
      ? notifications
      : []
    return [
      ...eventsFromSalesOrders(Array.isArray(salesOrders) ? salesOrders : []),
      ...eventsFromJobCards(Array.isArray(jobCards) ? jobCards : []),
      ...eventsFromTransactions(Array.isArray(transactions) ? transactions : []),
      ...eventsFromDispatch(Array.isArray(readyJobs) ? readyJobs : []),
      ...eventsFromNotifications(notifItems),
      ...eventsFromUsers(Array.isArray(usersData) ? usersData : []),
    ].sort(
      (a, b) =>
        (parseTimestamp(b.timestamp)?.getTime() || 0) - (parseTimestamp(a.timestamp)?.getTime() || 0),
    )
  }, [salesOrders, jobCards, transactions, readyJobs, notifications, usersData])

  const actorOptions = useMemo(
    () => Array.from(new Set(events.map((e) => e.actor).filter(Boolean))).sort(),
    [events],
  )

  /* ------ filtering ------ */
  const visibleEvents = useMemo(() => {
    const start = rangeStart(range)
    const term = deferredQuery.toLowerCase()
    return events.filter((event) => {
      if (stream !== "all" && event.stream !== stream) return false
      if (actor !== "ALL" && event.actor !== actor) return false
      if (severity !== "ALL" && event.severity !== severity) return false
      if (start) {
        const parsed = parseTimestamp(event.timestamp)
        if (parsed && parsed < start) return false
      }
      if (term && !eventBlob(event).includes(term)) return false
      return true
    })
  }, [events, stream, actor, severity, range, deferredQuery])

  const sev = useMemo(() => bucketBySeverity(visibleEvents), [visibleEvents])
  const usersList = Array.isArray(usersData) ? usersData : []
  const activeUserCount = usersList.filter((u: any) => u.is_active !== false).length
  const totalEvents = events.length
  const totalActors = new Set(events.map((e) => e.actor)).size

  const lastSynced = useMemo(() => {
    const newest = events[0]?.timestamp
    return newest ? relativeTime(newest) : "no data yet"
  }, [events])

  /* ------ counts per tab (for badge chips) ------ */
  const tabCounts: Record<TabKey, number> = {
    overview: visibleEvents.length,
    feed: visibleEvents.length,
    users: usersList.length,
    notifications: visibleEvents.filter((e) => e.stream === "notifications").length,
    lifecycle: visibleEvents.filter((e) => e.stream === "sales" || e.stream === "production" || e.stream === "dispatch").length,
    inventory: visibleEvents.filter((e) => e.stream === "inventory").length,
  }

  /* ------ handlers ------ */
  const handleRefresh = () => {
    refetchSales()
    refetchJobs()
    refetchTxns()
    refetchDispatch()
    refetchNotifs()
    refetchUsers()
  }

  const resetFilters = () => {
    setQuery("")
    setStream("all")
    setRange("7d")
    setActor("ALL")
    setSeverity("ALL")
  }

  if (!canAccess) {
    return (
      <div className="max-w-2xl space-y-6 animate-enter-up">
        <section className="rounded-[2rem] border border-amber-200 bg-amber-50 p-8 shadow-premium">
          <div className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700">
            <ShieldCheck className="h-3.5 w-3.5" />
            Audit Access
          </div>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950">Audit Center</h1>
          <p className="mt-3 text-sm font-semibold leading-6 text-slate-700">
            Audit Center is limited to Owner and Admin roles. Talk to your administrator to request access.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/dashboard">
              <Button className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800">
                Back to dashboard
              </Button>
            </Link>
          </div>
        </section>
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-enter-up">
      <ExecutiveHero
        testId="audit-center-hero"
        badge="Audit & Governance"
        title="Who did what, when, and from where — the owner's audit pane"
        description="Activity synthesized from every operational source: sales, production, inventory, dispatch, notifications, and user sessions. Trace any event, filter by stream, actor or severity, and export anything."
        actions={
          <>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/70 bg-white/90 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-700">
              <Sparkles className="h-3.5 w-3.5" />
              Owner / Admin only
            </span>
            <span className={cn(
              "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.18em]",
              liveTail
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-slate-200 bg-white text-slate-600",
            )}>
              <span className={cn("h-1.5 w-1.5 rounded-full", liveTail ? "bg-emerald-500" : "bg-slate-400")} />
              {liveTail ? "Live" : "Paused"}
            </span>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/70 bg-white/90 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-600">
              Synced {lastSynced}
            </span>
          </>
        }
        aside={
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-[1.15rem] border border-white/10 bg-white/10 p-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-100">Events</p>
                <p className="mt-2 text-2xl font-semibold">{formatNumber(totalEvents)}</p>
                <p className="mt-1 text-[11px] text-slate-200/85">{formatNumber(visibleEvents.length)} after filter</p>
              </div>
              <div className="rounded-[1.15rem] border border-white/10 bg-white/10 p-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-100">Actors</p>
                <p className="mt-2 text-2xl font-semibold">{formatNumber(totalActors)}</p>
                <p className="mt-1 text-[11px] text-slate-200/85">{activeUserCount} active users</p>
              </div>
              <div className="rounded-[1.15rem] border border-white/10 bg-white/10 p-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-100">Critical</p>
                <p className="mt-2 text-2xl font-semibold">{formatNumber(sev.CRITICAL + sev.HIGH)}</p>
                <p className="mt-1 text-[11px] text-slate-200/85">{sev.CRITICAL} crit · {sev.HIGH} high</p>
              </div>
              <div className="rounded-[1.15rem] border border-white/10 bg-white/10 p-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-100">Streams</p>
                <p className="mt-2 text-2xl font-semibold">{STREAMS.length}</p>
                <p className="mt-1 text-[11px] text-slate-200/85">all wired</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge value={sev.CRITICAL > 0 ? "BLOCKED" : "ACTIVE"} label={`${formatNumber(sev.CRITICAL)} critical`} />
              <StatusBadge value={sev.HIGH > 0 ? "QC_HOLD" : "ACTIVE"} label={`${formatNumber(sev.HIGH)} high`} />
              <StatusBadge value="READY" label={`${formatNumber(sev.MEDIUM)} medium`} />
            </div>
          </div>
        }
      />

      {/* Filter bar */}
      <section
        data-testid="audit-filter-bar"
        className="sticky top-[5.25rem] z-10 flex flex-wrap items-center gap-3 rounded-[1.4rem] border border-white/70 bg-white/85 p-3 shadow-lg backdrop-blur"
      >
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search actor, action, entity, reference…"
            className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm shadow-sm focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-100"
          />
        </div>
        <select
          value={stream}
          onChange={(e) => setStream(e.target.value as AuditStream | "all")}
          className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-[12.5px] font-semibold text-slate-700 shadow-sm focus:border-cyan-400 focus:outline-none"
        >
          <option value="all">All streams</option>
          {STREAMS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.short}
            </option>
          ))}
        </select>
        <select
          value={range}
          onChange={(e) => setRange(e.target.value as DateRange)}
          className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-[12.5px] font-semibold text-slate-700 shadow-sm focus:border-cyan-400 focus:outline-none"
        >
          {RANGE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          value={actor}
          onChange={(e) => setActor(e.target.value)}
          className="h-10 max-w-[180px] rounded-xl border border-slate-200 bg-white px-3 text-[12.5px] font-semibold text-slate-700 shadow-sm focus:border-cyan-400 focus:outline-none"
        >
          <option value="ALL">All actors</option>
          {actorOptions.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <select
          value={severity}
          onChange={(e) => setSeverity(e.target.value as Severity | "ALL")}
          className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-[12.5px] font-semibold text-slate-700 shadow-sm focus:border-cyan-400 focus:outline-none"
        >
          <option value="ALL">All severity</option>
          <option value="CRITICAL">Critical</option>
          <option value="HIGH">High</option>
          <option value="MEDIUM">Medium</option>
          <option value="LOW">Low</option>
        </select>
        <div className="ml-auto flex items-center gap-2">
          <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-600">
            {formatNumber(visibleEvents.length)} events
          </span>
          <button
            onClick={() => setLiveTail((v) => !v)}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-[12px] font-bold uppercase tracking-[0.1em] text-slate-700 transition hover:border-cyan-300 hover:text-cyan-800"
          >
            {liveTail ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            {liveTail ? "Live" : "Paused"}
          </button>
          <button
            onClick={handleRefresh}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-[12px] font-bold uppercase tracking-[0.1em] text-slate-700 transition hover:border-cyan-300 hover:text-cyan-800"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
          <button
            onClick={() => downloadCsv(`hariom-audit-${new Date().toISOString().slice(0, 10)}.csv`, visibleEvents)}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-[12px] font-bold uppercase tracking-[0.1em] text-slate-700 transition hover:border-cyan-300 hover:text-cyan-800"
          >
            <Download className="h-3.5 w-3.5" />
            Export
          </button>
          <button
            onClick={resetFilters}
            className="inline-flex h-9 items-center rounded-xl px-3 text-[12px] font-bold uppercase tracking-[0.1em] text-slate-500 transition hover:text-slate-800"
          >
            Reset
          </button>
        </div>
      </section>

      {/* Tabs bar */}
      <nav className="flex flex-wrap items-center gap-2 overflow-x-auto rounded-full border border-white/70 bg-white/85 p-1.5 shadow-sm backdrop-blur">
        {TAB_LIST.map((t) => {
          const Icon = t.icon
          const active = tab === t.key
          const count = tabCounts[t.key]
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                "inline-flex items-center gap-2 rounded-full px-4 py-2 text-[12.5px] font-semibold transition",
                active
                  ? "bg-gradient-to-br from-cyan-700 via-cyan-600 to-emerald-500 text-white shadow-md"
                  : "text-slate-700 hover:bg-cyan-50 hover:text-cyan-800",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
              {count > 0 ? (
                <span
                  className={cn(
                    "ml-1 rounded-full px-2 py-0.5 text-[10px] font-bold",
                    active ? "bg-white/25 text-white" : "bg-slate-100 text-slate-700",
                  )}
                >
                  {formatNumber(count)}
                </span>
              ) : null}
            </button>
          )
        })}
      </nav>

      {/* Tab content */}
      {tab === "overview" && (
        <AuditOverview
          events={visibleEvents}
          onSelect={setSelectedEvent}
          lastSynced={lastSynced}
          activeUserCount={activeUserCount}
          totalUserCount={usersList.length}
        />
      )}
      {tab === "feed" && <AuditFeed events={visibleEvents} onSelect={setSelectedEvent} />}
      {tab === "users" && <AuditUsers users={usersList} events={visibleEvents} onSelect={setSelectedEvent} />}
      {tab === "notifications" && <AuditNotifications events={visibleEvents} onSelect={setSelectedEvent} />}
      {tab === "lifecycle" && (
        <AuditStreamTab
          events={visibleEvents}
          streams={["sales", "production", "dispatch"]}
          title="Sales · Production · Dispatch ledger"
          subtitle="Lifecycle events from order to dispatch — every actor and reference visible."
          onSelect={setSelectedEvent}
          emptyHint="Once sales orders, job cards, or dispatch handoffs are recorded, they will appear here."
        />
      )}
      {tab === "inventory" && (
        <AuditStreamTab
          events={visibleEvents}
          streams={["inventory"]}
          title="Inventory ledger audit"
          subtitle="Every inward, issue, adjustment, and stock-cert event with full actor trail."
          onSelect={setSelectedEvent}
          emptyHint="Inventory transactions will surface here as the ledger populates."
        />
      )}

      <EventDetailDialog event={selectedEvent} onClose={() => setSelectedEvent(null)} />
    </div>
  )
}
