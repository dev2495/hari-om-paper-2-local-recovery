"use client"

import dayjs from "dayjs"
import Link from "next/link"
import { useMemo, useState, type MouseEvent, type ReactNode } from "react"
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  Factory,
  FlaskConical,
  Gauge,
  IndianRupee,
  LayoutDashboard,
  ListChecks,
  PackageCheck,
  PauseCircle,
  RefreshCw,
  ShieldAlert,
  TimerOff,
  Truck,
  Warehouse,
  Workflow,
  type LucideIcon,
} from "lucide-react"
import { Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, Pie, PieChart, XAxis, YAxis } from "recharts"

import { ChartBox, ChartEmptyState, ChartTooltip } from "@/components/erp/charts"
import { MetricCard, type MetricTone } from "@/components/erp/shell"
import { Donut, RadialGauge, StackedMeter } from "@/components/erp/viz"
import { useRouter } from "next/navigation"
import { useQueryClient } from "@tanstack/react-query"

import { ActionCenter } from "@/components/workspace/action-center"
import { invalidateInbox } from "@/components/workspace/notification-center"
import { WorkQueue } from "@/components/workspace/work-queue"
import { canReadJobCardAggregates } from "@/lib/role-matrix"
import { useAuth } from "@/context/AuthContext"
import { authApi } from "@/lib/api"
import { usePeopleVersion } from "@/hooks/use-people"
import { peopleInText, personLabel } from "@/lib/people"
import { useOwnerPack } from "@/hooks/use-analytics"
import { useJobCardAggregates } from "@/hooks/use-production"
import { useSalesOrderAggregates } from "@/hooks/use-sales"
import { useCustomers } from "@/hooks/use-master-data"
import { useNotifications } from "@/hooks/use-workspace"
import { jobCardRef } from "@/lib/job-card-display"
import { ACTION_LABELS, NOTIFICATION_CATEGORIES, notificationCategory, notificationPriority, relativeTime, type InboxNotification } from "@/lib/notifications"
import { displayPlantScope } from "@/lib/plant-scope"
import { cn } from "@/lib/utils"
import { LANDING_LABELS, inboxTargetFor, quickActionsFor, type LandingRole } from "@/lib/workspace"

type Period = "7d" | "30d" | "mtd" | "qtd"
const PERIODS: Array<[Period, string]> = [["7d", "7 days"], ["30d", "30 days"], ["mtd", "Month"], ["qtd", "Quarter"]]

function periodRange(period: Period) {
  const today = dayjs()
  const start =
    period === "7d" ? today.subtract(6, "day")
      : period === "30d" ? today.subtract(29, "day")
        : period === "mtd" ? today.startOf("month")
          : today.month(Math.floor(today.month() / 3) * 3).startOf("month")
  const days = today.diff(start, "day") + 1
  return { start_date: start.format("YYYY-MM-DD"), end_date: today.format("YYYY-MM-DD"), granularity: days > 45 ? "week" : "day" }
}

const inr = (value: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", notation: "compact", maximumFractionDigits: 1 }).format(Number.isFinite(value) ? value : 0)
const num = (value: number, digits = 0) => Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: digits })
const pct = (value: number) => `${num(value, 1)}%`
const has = (value: unknown) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value))

function bucketLabel(value: unknown) {
  const text = String(value || "")
  const parsed = dayjs(text)
  return /^\d{4}-\d{2}-\d{2}$/.test(text) && parsed.isValid() ? parsed.format("D MMM") : text
}

function greeting() {
  const hour = new Date().getHours()
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening"
}

type KpiKey =
  | "orderBook" | "bookedValue" | "dispatchedValue" | "dispatchQty" | "otif" | "leadTime" | "activeCards" | "blocked" | "adherence"
  | "utilization" | "qcPass" | "qcHolds" | "inventoryValue" | "lowStock" | "dispatchReady" | "expired" | "holdQty" | "produced" | "overdue"

const ROLE_KPIS: Record<LandingRole, KpiKey[]> = {
  Owner: ["orderBook", "dispatchedValue", "otif", "dispatchQty", "activeCards", "adherence", "inventoryValue", "qcPass"],
  Admin: ["orderBook", "dispatchedValue", "otif", "dispatchQty", "activeCards", "adherence", "inventoryValue", "qcPass"],
  PlantManager: ["activeCards", "overdue", "adherence", "utilization", "produced", "qcHolds", "dispatchReady", "lowStock"],
  Planner: ["activeCards", "overdue", "blocked", "adherence", "utilization", "produced", "lowStock", "expired"],
  Sales: ["orderBook", "dispatchedValue", "otif", "leadTime", "dispatchQty", "dispatchReady", "expired", "holdQty"],
  QC: ["qcPass", "qcHolds", "blocked", "activeCards"],
  Store: ["inventoryValue", "lowStock", "dispatchReady", "qcHolds"],
  Dispatch: ["dispatchReady", "dispatchQty", "otif", "overdue"],
  InwardQC: ["qcPass", "qcHolds", "lowStock", "inventoryValue"],
  InProcessQC: ["qcPass", "qcHolds", "blocked", "activeCards"],
  GRN: ["inventoryValue", "lowStock", "qcHolds", "activeCards"],
  RMIssue: ["activeCards", "lowStock", "inventoryValue", "produced"],
  Operator: ["activeCards", "overdue", "produced", "qcHolds"],
}

type ChartKey = "output" | "orderFlow" | "pipeline" | "machines" | "quality" | "inventory" | "customers" | "orderStatus" | "stageDonut" | "commercial"
const ROLE_CHARTS: Record<LandingRole, ChartKey[]> = {
  Owner: ["orderFlow", "output", "orderStatus", "stageDonut", "commercial", "pipeline", "machines", "inventory", "customers", "quality"],
  Admin: ["orderFlow", "output", "pipeline", "inventory"],
  PlantManager: ["output", "stageDonut", "pipeline", "machines", "quality"],
  Planner: ["pipeline", "output", "machines", "orderFlow"],
  Sales: ["orderFlow", "orderStatus", "commercial", "customers"],
  QC: ["quality", "pipeline"],
  Store: ["inventory", "output"],
  Dispatch: ["orderFlow", "pipeline"],
  InwardQC: ["quality", "inventory"],
  InProcessQC: ["quality", "pipeline"],
  GRN: ["inventory"],
  RMIssue: ["inventory", "pipeline"],
  Operator: ["pipeline", "output"],
}

// Where each figure comes from: sales aggregates, job-card aggregates, or the analytics owner pack.
const KPI_SOURCE: Record<KpiKey, "sales" | "jobs" | "pack"> = {
  orderBook: "sales", bookedValue: "sales", dispatchedValue: "sales", expired: "sales", holdQty: "sales",
  activeCards: "jobs", overdue: "jobs", blocked: "jobs", qcHolds: "jobs", dispatchReady: "jobs",
  otif: "pack", leadTime: "pack", dispatchQty: "pack", produced: "pack", adherence: "pack", utilization: "pack",
  qcPass: "pack", inventoryValue: "pack", lowStock: "pack",
}
const CHART_SOURCE: Record<ChartKey, "sales" | "jobs" | "pack"> = {
  output: "pack", orderFlow: "pack", pipeline: "pack", machines: "pack", quality: "pack", inventory: "pack",
  customers: "sales", orderStatus: "sales", commercial: "sales", stageDonut: "jobs",
}

const STAGE_ORDER = ["SLITTING", "WINDER", "OVEN", "PROCESS", "DISPATCH"]
const STAGE_COLORS: Record<string, string> = {
  winder_qty: "hsl(var(--chart-1))",
  oven_qty: "hsl(var(--chart-4))",
  process_qty: "hsl(var(--chart-3))",
  packing_qty: "hsl(var(--chart-7))",
}

function Card({ title, subtitle, action, children, className }: { title: string; subtitle?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("erp-panel flex min-w-0 flex-col rounded-xl p-4 sm:p-5", className)}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[14.5px] font-semibold tracking-tight">{title}</h3>
          {subtitle ? <p className="mt-0.5 text-[12.5px] leading-5 text-muted-foreground">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </section>
  )
}

function CardLink({ href, children }: { href: string; children: ReactNode }) {
  // 44 px tall tap target; the negative margin keeps the card header the same height.
  return (
    <Link href={href} className="group -my-3 -mr-2 inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-2 text-[12.5px] font-medium text-primary hover:bg-primary/[.06] focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
      {children}
      <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
    </Link>
  )
}

/**
 * One notification on the landing: the whole row is one link (at least 44 px tall) to a page this role
 * can open, or to the inbox; its action word shows only when the role can do it. Opening it marks it
 * read, as the bell does. Read/unread toggles stay in the inbox (no tiny buttons here).
 */
function InboxLine({ item, roles }: { item: InboxNotification; roles: Array<string | null | undefined> }) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const category = NOTIFICATION_CATEGORIES[notificationCategory(item)]
  const priority = notificationPriority(item)
  const target = inboxTargetFor(item, roles)
  const actionLabel = target.action && priority !== "info" ? ACTION_LABELS[target.action] : null
  // Older stage handoffs were sent to Operators with the planner's "Schedule the next machine…" line; a role
  // that cannot schedule reads only what happened (new ones are worded for the floor by the BFF, 30 Oct).
  // Services write who did it by login ("sent by pm.e2e@hariom.com"); people read names (spec C4).
  usePeopleVersion()
  const message = peopleInText(item.action === "schedule" && !target.action
    ? String(item.message || "").replace(/\s*Schedule the next machine or inspect before it proceeds\.?\s*$/, "")
    : item.message)
  const Icon = category.icon
  const open = async (event: MouseEvent<HTMLAnchorElement>) => {
    // A new tab / window keeps the browser's own behaviour.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
    event.preventDefault()
    router.push(target.href)
    if (!item.is_read) {
      try { await authApi.markNotificationRead(item.id) } catch { /* the link still opens */ } finally { await invalidateInbox(queryClient) }
    }
  }
  return (
    <Link href={target.href} onClick={open} className={cn("group flex min-h-11 gap-3 rounded-lg px-2.5 py-2.5 transition-colors hover:bg-foreground/[.035] focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring", !item.is_read && "bg-primary/[.035]")}>
      <span className={cn("relative mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg ring-1 ring-inset", category.chip)}>
        <Icon className="h-4 w-4" aria-hidden="true" />
        {priority === "critical" ? <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-destructive ring-2 ring-card" aria-label="Critical" /> : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-start gap-2">
          <span className={cn("min-w-0 flex-1 text-[13px] leading-5", item.is_read ? "font-medium text-foreground/80" : "font-semibold text-foreground")}>{item.title}</span>
          <span className="shrink-0 pt-0.5 text-[11px] tabular-nums text-muted-foreground">{relativeTime(item.created_at)}</span>
          {!item.is_read ? <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-primary" aria-label="Not read yet" /> : null}
        </span>
        {message ? <span className="mt-0.5 block text-[12.5px] leading-5 text-muted-foreground line-clamp-2">{message}</span> : null}
        <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-medium text-muted-foreground">{category.label}</span>
          {target.href === "/inbox" && item.href ? <span className="text-[11px] text-muted-foreground">· for your information</span> : null}
          {actionLabel ? (
            <span className={cn("ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold", priority === "critical" ? "bg-signal-rose-soft text-signal-rose-ink" : "bg-primary/10 text-primary")}>
              {actionLabel}
              <ArrowRight className="h-3 w-3" aria-hidden="true" />
            </span>
          ) : null}
        </span>
      </span>
    </Link>
  )
}

/**
 * One command center for every role: same data, shaped per job. Every number comes
 * from a server aggregate or the analytics owner pack for the chosen period; a failed
 * source renders "Not reported", never zero.
 */
const ANALYTICS_KPIS: KpiKey[] = ["orderBook", "bookedValue", "dispatchedValue", "otif", "leadTime", "dispatchQty", "produced", "activeCards", "overdue", "adherence", "utilization", "qcPass", "inventoryValue", "blocked"]
const ANALYTICS_CHARTS: ChartKey[] = ["orderFlow", "output", "orderStatus", "stageDonut", "commercial", "pipeline", "machines", "quality", "inventory", "customers"]
const OWNER_KPIS: KpiKey[] = ["orderBook", "bookedValue", "dispatchedValue", "otif", "dispatchQty", "produced", "leadTime", "activeCards", "overdue", "blocked", "adherence", "utilization", "qcPass", "qcHolds", "inventoryValue", "lowStock", "dispatchReady", "expired", "holdQty"]

export function CommandCenter({ role, testId, variant = "landing", header }: { role: LandingRole; testId?: string; variant?: "landing" | "analytics"; header?: ReactNode }) {
  const analytics = variant === "analytics"
  const ownerTabs = role === "Owner" && !analytics
  const [focus, setFocus] = useState<"kpis" | "actions">("kpis")
  const { user, activePlant, activeRole } = useAuth()
  const [period, setPeriod] = useState<Period>("30d")
  const range = useMemo(() => periodRange(period), [period])
  const packParams = useMemo(() => ({ ...range, ...(activePlant ? { plant: activePlant } : {}) }), [range, activePlant])
  // The owner pack needs analytics:view (Owner, Admin, Planner, PlantManager); other roles never ask for it,
  // so an Operator's landing and floor pages show no 403 (fixed 2026-10-30). Their KPIs read "Not reported".
  const packReadable = [user?.role, ...(user?.roles || [])].some((role) => ["Owner", "Admin", "Planner", "PlantManager"].includes(String(role)))
  const packQuery = useOwnerPack(packParams, { enabled: packReadable })
  const salesQuery = useSalesOrderAggregates()
  const jobsReadable = canReadJobCardAggregates([user?.role, ...(user?.roles || [])])
  const jobsQuery = useJobCardAggregates(jobsReadable)
  const inbox = useNotifications({ limit: 6 })
  const customersQuery = useCustomers()
  const customerNames = useMemo(() => new Map((Array.isArray(customersQuery.data) ? customersQuery.data : []).map((row: any) => [String(row.id), String(row.name || row.customer_name || row.customer_code || "")])), [customersQuery.data])

  const pack: any = useMemo(() => packQuery.data || {}, [packQuery.data])
  const salesAggregates: any = salesQuery.data || {}
  const jobs: any = jobsQuery.data || {}
  const packReady = Boolean(packQuery.data)
  const fetching = packQuery.isFetching || salesQuery.isFetching || jobsQuery.isFetching

  const productionSeries: any[] = Array.isArray(pack.production?.series) ? pack.production.series : []
  const orderSeries: any[] = Array.isArray(pack.sales?.series) ? pack.sales?.series : []
  const qualitySeries: any[] = Array.isArray(pack.quality?.series) ? pack.quality.series : []
  const outputRows = productionSeries.map((row) => ({ label: bucketLabel(row.bucket), winder_qty: Number(row.winder_qty || 0), oven_qty: Number(row.oven_qty || 0), process_qty: Number(row.process_qty || 0), packing_qty: Number(row.packing_qty || 0) }))
  const produced = outputRows.reduce((total, row) => total + row.packing_qty, 0)
  const flowRows = orderSeries.map((row) => ({ label: bucketLabel(row.bucket), created: Number(row.orders_created || 0), closed: Number(row.orders_closed || 0), dispatch: Number(row.dispatch_qty || 0) }))
  const qualityRows = qualitySeries.map((row) => ({ label: bucketLabel(row.bucket), passed: Number(row.passed || 0), failed: Number(row.failed || 0) }))
  // Packing and QC close with Process, so their counts belong to Process.
  const pipelineCounts = new Map<string, number>()
  for (const row of Array.isArray(pack.production?.stage_pipeline) ? pack.production.stage_pipeline : []) {
    const raw = String(row.stage_type || "").toUpperCase()
    const stage = raw === "PACKING" || raw === "QC" ? "PROCESS" : raw
    pipelineCounts.set(stage, (pipelineCounts.get(stage) || 0) + Number(row.count || 0))
  }
  const pipelineRows = Array.from(pipelineCounts, ([stage, count]) => ({ stage, count }))
    .sort((a: any, b: any) => (STAGE_ORDER.indexOf(a.stage) + 99) % 99 - (STAGE_ORDER.indexOf(b.stage) + 99) % 99)
  const machineRows = (Array.isArray(pack.production?.machine_utilization) ? pack.production.machine_utilization : []).slice(0, 8)
  const inv: any = pack.inventory?.summary || {}
  const inventoryMix = [
    { name: "Raw material", value: Number(inv.rm_value || 0), color: "hsl(var(--chart-2))" },
    { name: "Work in progress", value: Number(inv.wip_value || 0), color: "hsl(var(--chart-6))" },
    { name: "Finished goods", value: Number(inv.fg_value || 0), color: "hsl(var(--chart-7))" },
  ].filter((row) => row.value > 0)
  const customers = (Array.isArray(salesAggregates?.open_value_by_customer) ? salesAggregates?.open_value_by_customer : []).slice(0, 6)

  const spark = (key: string, rows: any[]) => rows.map((row) => Number(row[key] || 0))
  const kpis: Record<KpiKey, { label: string; value: string; detail: string; icon: LucideIcon; tone: MetricTone; href?: string; spark?: number[]; progress?: number | null; ready: boolean }> = {
    orderBook: { label: "Open order book", value: inr(Number(salesAggregates?.open_order_book_value)), detail: `${num(salesAggregates?.open_order_count)} open orders · ${num(salesAggregates?.open_qty)} pcs`, icon: IndianRupee, tone: "teal", href: "/sales-orders", ready: has(salesAggregates?.open_order_book_value) },
    bookedValue: { label: "Booked value", value: inr(Number(salesAggregates?.booked_value)), detail: `${num(salesAggregates?.total_order_count)} orders booked, all time`, icon: IndianRupee, tone: "blue", href: "/sales-orders?status=all", ready: has(salesAggregates?.booked_value) },
    dispatchedValue: { label: "Dispatched value", value: inr(Number(salesAggregates?.dispatched_value)), detail: "Fulfilled quantity × line rate, all time", icon: Truck, tone: "emerald", href: "/reports/dispatch", ready: has(salesAggregates?.dispatched_value) },
    dispatchQty: { label: "Dispatched in period", value: `${num(pack.dispatch?.summary?.dispatch_qty)} pcs`, detail: `${num(pack.dispatch?.summary?.closed_orders)} orders closed`, icon: PackageCheck, tone: "cyan", spark: spark("dispatch_qty", orderSeries), href: "/reports/dispatch", ready: packReady },
    otif: { label: "On time, in full", value: pack.sales?.summary?.closed_orders ? pct(Number(pack.sales?.summary.otif_percent)) : "No closures", detail: `${num(pack.sales?.summary?.closed_orders)} closed orders measured`, icon: Gauge, tone: "violet", progress: pack.sales?.summary?.closed_orders ? Number(pack.sales?.summary.otif_percent) : null, href: "/reports/sales", ready: packReady },
    leadTime: { label: "Release → dispatch", value: pack.sales?.summary?.release_to_dispatch_days ? `${num(pack.sales?.summary.release_to_dispatch_days, 1)} days` : "—", detail: "Average order lead time on closed orders", icon: CalendarClock, tone: "blue", ready: packReady },
    activeCards: { label: "Open job cards", value: num(jobs.open_cards), detail: `${num(jobs.due_priority)} due soon · ${num(jobs.completed_cards)} completed`, icon: Factory, tone: "blue", href: "/production/job-cards", ready: has(jobs.open_cards) },
    overdue: { label: "Overdue job cards", value: num(jobs.due_overdue), detail: jobs.overdue_label || "Past their promised date", icon: TimerOff, tone: Number(jobs.due_overdue) ? "rose" : "slate", href: "/production/job-cards?due=overdue", ready: has(jobs.due_overdue) },
    blocked: { label: "Blocked cards", value: num(jobs.blocked), detail: "Waiting on material, machine or a decision", icon: ShieldAlert, tone: Number(jobs.blocked) ? "rose" : "slate", href: "/production/job-cards", ready: has(jobs.blocked) },
    adherence: { label: "Schedule adherence", value: pct(Number(pack.production?.summary?.schedule_adherence_percent)), detail: "Stages finished on their planned day", icon: ClipboardCheck, tone: "amber", progress: Number(pack.production?.summary?.schedule_adherence_percent), href: "/reports/operations", ready: packReady },
    utilization: Number(pack.production?.summary?.avg_machine_utilization_percent) > 400
      ? { label: "Machine load", value: "Not comparable", detail: "Machine capacity and assigned load are in different units — fix capacity in machine setup", icon: Workflow, tone: "amber", href: "/system/machines", ready: packReady }
      : { label: "Machine load", value: pct(Number(pack.production?.summary?.avg_machine_utilization_percent)), detail: "Assigned load vs rated capacity, top machines", icon: Workflow, tone: "violet", progress: Number(pack.production?.summary?.avg_machine_utilization_percent), href: "/reports/production", ready: packReady },
    qcPass: { label: "QC pass rate", value: pack.quality?.summary?.has_inspection_data ? pct(Number(pack.quality.summary.pass_rate)) : "No inspections", detail: `${num(pack.quality?.summary?.checked)} checked · ${num(pack.quality?.summary?.failed)} failed`, icon: FlaskConical, tone: "emerald", progress: pack.quality?.summary?.has_inspection_data ? Number(pack.quality.summary.pass_rate) : null, href: "/reports/quality", ready: packReady },
    qcHolds: { label: "Open QC holds", value: num(jobs.qc_holds), detail: "Job cards stopped for a quality decision", icon: PauseCircle, tone: Number(jobs.qc_holds) ? "amber" : "slate", href: "/quality", ready: has(jobs.qc_holds) },
    inventoryValue: { label: "Inventory value", value: inr(Number(inv.total_value)), detail: `RM ${inr(Number(inv.rm_value))} · WIP ${inr(Number(inv.wip_value))} · FG ${inr(Number(inv.fg_value))}`, icon: Warehouse, tone: "violet", href: "/inventory", ready: packReady },
    lowStock: { label: "Low-stock materials", value: num(inv.low_stock_count), detail: `${num(inv.overstock_count)} overstocked`, icon: Boxes, tone: Number(inv.low_stock_count) ? "amber" : "slate", href: "/inventory/stock-alerts", ready: packReady },
    dispatchReady: { label: "Ready to dispatch", value: num(jobs.dispatch_ready), detail: "Finished and cleared job cards", icon: Truck, tone: "emerald", href: "/logistics/dispatch", ready: has(jobs.dispatch_ready) },
    expired: { label: "Expired sales orders", value: num(salesAggregates?.expired_open_count), detail: `${num(salesAggregates?.expiring_7d_count)} more expire within 7 days`, icon: TimerOff, tone: Number(salesAggregates?.expired_open_count) ? "rose" : "slate", href: "/sales-orders", ready: has(salesAggregates?.expired_open_count) },
    holdQty: { label: "On customer hold", value: `${num(salesAggregates?.hold_qty)} pcs`, detail: `${num(salesAggregates?.held_order_count)} POs held and closed`, icon: PauseCircle, tone: "amber", href: "/sales-orders?status=closed", ready: has(salesAggregates?.hold_qty) },
    produced: { label: "Packed in period", value: `${num(produced)} pcs`, detail: "Finished output recorded at packing", icon: PackageCheck, tone: "teal", spark: outputRows.map((row) => row.packing_qty), href: "/reports/production", ready: packReady },
  }

  const attention = useMemo(() => {
    const rows: Array<{ id: string; area: string; title: string; detail: string; href: string; tone: "rose" | "amber" }> = []
    for (const row of (pack.sales?.delayed_rows || []).slice(0, 4)) rows.push({ id: `d-${row.order_id}`, area: "Late order", title: row.order_no || "Order", detail: `${row.customer_name || "Customer"} · due ${row.due_date ? dayjs(row.due_date).format("D MMM") : "—"}`, href: `/sales-orders/${row.order_id}`, tone: "rose" })
    for (const row of (pack.production?.blocked_rows || []).slice(0, 4)) rows.push({ id: `b-${row.job_card_id || row.id}`, area: "Blocked", title: jobCardRef(row), detail: `${String(row.current_stage || "Stage").toLowerCase()} · ${row.block_reason || row.reason || row.customer_name || "needs a decision"}`, href: `/production/job-cards/${row.job_card_id || row.id}`, tone: "rose" })
    for (const row of (pack.exceptions?.active_holds || []).slice(0, 3)) rows.push({ id: `h-${row.id}`, area: "QC hold", title: jobCardRef(row), detail: row.reason || "Quality hold", href: "/quality", tone: "amber" })
    for (const row of (pack.inventory?.risk_items?.low_stock || []).slice(0, 3)) rows.push({ id: `s-${row.id || row.item_code}`, area: "Low stock", title: row.name || row.item_code || "Material", detail: `${num(row.available_qty)} available`, href: "/inventory/stock-alerts", tone: "amber" })
    return rows
  }, [pack])

  // The headline counts the same figures as the tiles below it (overdue, blocked, QC holds from the job-card
  // aggregates; late orders and low stock from the pack), and never says "nothing is late" while a source is
  // still loading or failed (pm.e2e saw "Nothing is late" above "Overdue job cards 3", 30 Oct).
  const plantWords = displayPlantScope(activePlant, "all plants")
  const headline = (() => {
    if (!packReadable) return `Your work in ${plantWords}: start from the shortcuts below and see what was handed to you.`
    const jobsReady = jobsReadable && Boolean(jobsQuery.data)
    const counted = (count: number, one: string, many: string) => `${num(count)} ${count === 1 ? one : many}`
    const parts: string[] = []
    if (jobsReady) {
      if (Number(jobs.due_overdue) > 0) parts.push(counted(Number(jobs.due_overdue), "overdue job card", "overdue job cards"))
      if (Number(jobs.blocked) > 0) parts.push(counted(Number(jobs.blocked), "blocked card", "blocked cards"))
      if (Number(jobs.qc_holds) > 0) parts.push(counted(Number(jobs.qc_holds), "card on QC hold", "cards on QC hold"))
    }
    if (packReady) {
      const lateOrders = Number(pack.sales?.summary?.delayed_orders ?? (pack.sales?.delayed_rows || []).length)
      if (lateOrders > 0) parts.push(counted(lateOrders, "late order", "late orders"))
      if (Number(inv.low_stock_count) > 0) parts.push(counted(Number(inv.low_stock_count), "low-stock material", "low-stock materials"))
    }
    if (parts.length) {
      const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`
      return `${list} ${parts.length === 1 && /^1 /.test(parts[0]) ? "needs" : "need"} attention in ${plantWords}.`
    }
    const jobsFailed = jobsReadable && jobsQuery.isError
    const waiting = (jobsReadable && !jobsReady && !jobsFailed) || (!packReady && !packQuery.isError)
    if (waiting) return `Checking what needs attention in ${plantWords}…`
    if (jobsFailed || packQuery.isError) return `Some figures could not be loaded just now, so this may not be the full picture for ${plantWords}. Refresh in a minute.`
    return `Nothing is late or blocked in ${plantWords}. Here is how the period is going.`
  })()

  // A role sees only the figures and charts whose source it may read: no "Not reported" tiles, empty charts
  // or forever-loading dots for an Operator, Store or QC landing (2026-10-30).
  const readable = (source: "sales" | "jobs" | "pack") => (source === "pack" ? packReadable : source === "jobs" ? jobsReadable : true)
  const charts = (analytics ? ANALYTICS_CHARTS : ROLE_CHARTS[role]).filter((key) => readable(CHART_SOURCE[key]))
  const kpiKeys = (analytics ? ANALYTICS_KPIS : ownerTabs ? OWNER_KPIS : ROLE_KPIS[role]).filter((key) => readable(KPI_SOURCE[key]))
  // The person's directory name ("Operator two (E2E)"), never a role word or a login (30 Oct).
  const greetName = String(user?.name || "").trim() || (user?.email ? personLabel(user.email, "") : "")
  const userRoles = [user?.role, activeRole, ...(user?.roles || [])]
  const inboxItems = (Array.isArray(inbox.data?.items) ? inbox.data.items : []) as InboxNotification[]
  const quick = quickActionsFor(role, userRoles)
  // refetch() ignores `enabled`, so only the sources this role may read are asked again (no 403 on Refresh).
  const refresh = () => {
    if (packReadable) void packQuery.refetch()
    void salesQuery.refetch()
    if (jobsReadable) void jobsQuery.refetch()
    void inbox.refetch()
  }

  const chart: Record<ChartKey, ReactNode> = {
    output: (
      <Card key="output" title="Production output by stage" subtitle="Pieces recorded at each stage in the period" action={<CardLink href="/reports/production">Throughput</CardLink>}>
        {outputRows.some((row) => row.winder_qty + row.oven_qty + row.process_qty + row.packing_qty > 0) ? (
          <ChartBox height={260}>
            <BarChart data={outputRows} margin={{ top: 4, right: 4, left: -8, bottom: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={16} />
              <YAxis tickLine={false} axisLine={false} width={48} tickFormatter={(value) => num(value)} />
              <ChartTooltip />
              <Legend iconType="circle" iconSize={8} />
              {(["winder_qty", "oven_qty", "process_qty", "packing_qty"] as const).map((key, index, keys) => (
                <Bar key={key} dataKey={key} name={key.replace("_qty", "").replace(/^./, (c) => c.toUpperCase())} stackId="stage" fill={STAGE_COLORS[key]} radius={index === keys.length - 1 ? [3, 3, 0, 0] : 0} maxBarSize={26} />
              ))}
            </BarChart>
          </ChartBox>
        ) : <div className="h-[260px]"><ChartEmptyState label={packQuery.isLoading ? "Loading output…" : "No stage output recorded in this period."} /></div>}
      </Card>
    ),
    orderFlow: (
      <Card key="orderFlow" title="Order flow" subtitle="Orders booked vs closed, with pieces dispatched" action={<CardLink href="/reports/sales">Sales pulse</CardLink>}>
        {flowRows.some((row) => row.created + row.closed + row.dispatch > 0) ? (
          <ChartBox height={260}>
            <ComposedChart data={flowRows} margin={{ top: 4, right: 4, left: -8, bottom: 0 }}>
              <defs>
                <linearGradient id="cc-dispatch" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--chart-1))" stopOpacity={0.22} />
                  <stop offset="100%" stopColor="hsl(var(--chart-1))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={16} />
              <YAxis yAxisId="orders" tickLine={false} axisLine={false} width={32} allowDecimals={false} />
              <YAxis yAxisId="pcs" orientation="right" tickLine={false} axisLine={false} width={48} tickFormatter={(value) => num(value)} />
              <ChartTooltip />
              <Legend iconType="circle" iconSize={8} />
              <Area yAxisId="pcs" type="monotone" dataKey="dispatch" name="Dispatched pcs" stroke="hsl(var(--chart-1))" fill="url(#cc-dispatch)" strokeWidth={2} />
              <Bar yAxisId="orders" dataKey="created" name="Orders booked" fill="hsl(var(--chart-2))" radius={[3, 3, 0, 0]} maxBarSize={14} />
              <Line yAxisId="orders" type="monotone" dataKey="closed" name="Orders closed" stroke="hsl(var(--chart-7))" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ChartBox>
        ) : <div className="h-[260px]"><ChartEmptyState label={packQuery.isLoading ? "Loading order flow…" : "No orders booked, closed or dispatched in this period."} /></div>}
      </Card>
    ),
    pipeline: (
      <Card key="pipeline" title="Where open work is" subtitle="Open job cards by current stage" action={<CardLink href="/production/job-cards">Job cards</CardLink>}>
        {pipelineRows.length ? (
          <div className="space-y-2">
            {pipelineRows.map((row: any, index: number) => {
              const max = Math.max(1, ...pipelineRows.map((item: any) => item.count))
              return (
                <Link key={row.stage} href={`/production/job-cards?stage=${row.stage}`} className="group flex min-h-11 flex-col justify-center rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
                  <div className="flex items-center justify-between text-[12.5px]">
                    <span className="font-medium text-foreground/85 group-hover:text-primary">{row.stage.charAt(0) + row.stage.slice(1).toLowerCase()}</span>
                    <span className="font-semibold tabular-nums">{num(row.count)}</span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
                    <div className="h-full origin-left rounded-full animate-[bar-grow_700ms_var(--ease-workspace)_both]" style={{ width: `${(row.count / max) * 100}%`, background: `hsl(var(--chart-${(index % 8) + 1}))`, animationDelay: `${index * 60}ms` }} />
                  </div>
                </Link>
              )
            })}
          </div>
        ) : <p className="py-10 text-center text-[13px] text-muted-foreground">{packQuery.isLoading ? "Loading…" : "No open job cards."}</p>}
      </Card>
    ),
    machines: (
      <Card key="machines" title="Machine load" subtitle="Assigned load against rated capacity" action={<CardLink href="/planning/board">Planner</CardLink>}>
        {machineRows.length ? (
          <div className="space-y-2">
            {machineRows.map((row: any) => {
              const value = Number(row.utilization_percent || 0)
              return (
                <div key={row.machine_id}>
                  <div className="flex items-center justify-between gap-2 text-[12.5px]">
                    <span className="truncate font-medium text-foreground/85">{row.machine_code}<span className="font-normal text-muted-foreground"> · {num(row.jobs)} jobs</span></span>
                    <span className={cn("font-semibold tabular-nums", value > 100 ? "text-signal-rose-ink" : value > 85 ? "text-signal-amber-ink" : "")} title={value > 400 ? `${num(row.assigned_load)} assigned vs capacity ${num(row.capacity_value)} — units differ` : undefined}>{value > 400 ? "Units differ" : pct(value)}</span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
                    <div className={cn("h-full origin-left rounded-full animate-[bar-grow_700ms_var(--ease-workspace)_both]", value > 100 ? "bg-signal-rose-ink/70" : value > 85 ? "bg-signal-amber-ink/70" : "bg-primary/70")} style={{ width: `${Math.min(100, value)}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        ) : <p className="py-10 text-center text-[13px] text-muted-foreground">{packQuery.isLoading ? "Loading…" : "No machine assignments yet."}</p>}
      </Card>
    ),
    quality: (
      <Card key="quality" title="Inspection results" subtitle={pack.quality?.summary?.has_inspection_data ? `${num(pack.quality.summary.checked)} inspections · ${pct(Number(pack.quality.summary.pass_rate))} pass` : "Pass and fail by day"} action={<CardLink href="/reports/quality">Quality</CardLink>}>
        {qualityRows.some((row) => row.passed + row.failed > 0) ? (
          <>
            <ChartBox height={200}>
              <BarChart data={qualityRows} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={16} />
                <YAxis tickLine={false} axisLine={false} width={32} allowDecimals={false} />
                <ChartTooltip />
                <Bar dataKey="passed" name="Passed" stackId="q" fill="hsl(var(--chart-7))" maxBarSize={22} />
                <Bar dataKey="failed" name="Failed" stackId="q" fill="hsl(var(--chart-5))" radius={[3, 3, 0, 0]} maxBarSize={22} />
              </BarChart>
            </ChartBox>
            {(pack.quality?.fail_by_stage || []).length ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {(pack.quality.fail_by_stage as any[]).slice(0, 5).map((row) => (
                  <span key={row.stage_type} className="rounded-full border border-signal-rose-line bg-signal-rose-soft px-2 py-0.5 text-[11.5px] font-medium text-signal-rose-ink">{String(row.stage_type).toLowerCase()} · {row.count} fail</span>
                ))}
              </div>
            ) : null}
          </>
        ) : <div className="h-[200px]"><ChartEmptyState label={packQuery.isLoading ? "Loading inspections…" : "No inspections recorded in this period."} /></div>}
      </Card>
    ),
    inventory: (
      <Card key="inventory" title="Inventory mix" subtitle={`${inr(Number(inv.total_value))} across RM, WIP and FG`} action={<CardLink href="/inventory">Stock</CardLink>}>
        {inventoryMix.length ? (
          <div className="flex flex-col items-center gap-4 sm:flex-row">
            <div className="h-[170px] w-[170px] shrink-0">
              <ChartBox height={170}>
                <PieChart>
                  <Pie data={inventoryMix} dataKey="value" nameKey="name" innerRadius={52} outerRadius={78} paddingAngle={2} strokeWidth={2} animationDuration={800}>
                    {inventoryMix.map((row) => <Cell key={row.name} fill={row.color} />)}
                  </Pie>
                  <ChartTooltip />
                </PieChart>
              </ChartBox>
            </div>
            <dl className="w-full space-y-2">
              {inventoryMix.map((row) => (
                <div key={row.name} className="flex items-center gap-2 text-[13px]">
                  <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: row.color }} />
                  <dt className="flex-1 text-foreground/80">{row.name}</dt>
                  <dd className="font-semibold tabular-nums">{inr(row.value)}</dd>
                  <dd className="w-12 text-right text-[12px] tabular-nums text-muted-foreground">{pct((row.value / Math.max(1, Number(inv.total_value) || inventoryMix.reduce((t, r) => t + r.value, 0))) * 100)}</dd>
                </div>
              ))}
              <div className="flex gap-4 border-t border-border pt-2 text-[12px] text-muted-foreground">
                <span>QC hold <strong className="text-foreground">{num(inv.qc_hold_qty)}</strong></span>
                <span>Blocked <strong className="text-foreground">{num(inv.blocked_qty)}</strong></span>
              </div>
            </dl>
          </div>
        ) : <p className="py-10 text-center text-[13px] text-muted-foreground">{packQuery.isLoading ? "Loading…" : "No stock value reported for this scope."}</p>}
      </Card>
    ),
    customers: (
      <Card key="customers" title="Largest open orders by customer" subtitle="Open order value, server totals" action={<CardLink href="/sales-orders">Orders</CardLink>}>
        {customers.length ? (
          <div className="space-y-2.5">
            {customers.map((row: any, index: number) => {
              const max = Math.max(1, ...customers.map((item: any) => Number(item.open_value || 0)))
              return (
                <div key={row.customer_id}>
                  <div className="flex items-center justify-between gap-2 text-[12.5px]">
                    <span className="truncate text-foreground/85">{customerNames.get(String(row.customer_id)) || row.customer_name || "Customer"}</span>
                    <span className="font-semibold tabular-nums">{inr(Number(row.open_value || 0))}</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full origin-left rounded-full bg-gradient-to-r from-primary/60 to-primary animate-[bar-grow_700ms_var(--ease-workspace)_both]" style={{ width: `${(Number(row.open_value || 0) / max) * 100}%`, animationDelay: `${index * 50}ms` }} />
                  </div>
                </div>
              )
            })}
          </div>
        ) : <p className="py-10 text-center text-[13px] text-muted-foreground">No open order value.</p>}
      </Card>
    ),
    orderStatus: (
      <Card key="orderStatus" title="Order book by status" subtitle={`${num(salesAggregates?.total_order_count)} sales orders, server totals`} action={<CardLink href="/sales-orders?status=all">Orders</CardLink>}>
        <Donut
          centerLabel="orders"
          slices={[
            { label: "Draft / submitted", value: Number(salesAggregates?.draft_count || 0), color: "hsl(var(--chart-6))", href: "/sales-orders?status=draft" },
            { label: "Approved, not released", value: Number(salesAggregates?.approved_count || 0), color: "hsl(var(--chart-2))", href: "/sales-orders?status=approved" },
            { label: "Releasing / dispatching", value: Math.max(0, Number(salesAggregates?.ready_count || 0) - Number(salesAggregates?.approved_count || 0)), color: "hsl(var(--chart-1))", href: "/sales-orders?status=open" },
            { label: "Closed", value: Math.max(0, Number(salesAggregates?.total_order_count || 0) - Number(salesAggregates?.open_order_count || 0) - Number(salesAggregates?.held_order_count || 0)), color: "hsl(var(--chart-7))", href: "/sales-orders?status=closed" },
            { label: "Customer hold", value: Number(salesAggregates?.held_order_count || 0), color: "hsl(var(--chart-5))" },
          ]}
        />
      </Card>
    ),
    stageDonut: (
      <Card key="stageDonut" title="Open job cards by stage" subtitle={`${num(jobs.open_cards)} open · ${num(jobs.completed_cards)} completed`} action={<CardLink href="/production/job-cards">Job cards</CardLink>}>
        <Donut
          centerLabel="open cards"
          slices={(Array.isArray(jobs.stage_counts) ? jobs.stage_counts : []).map((row: any, index: number) => ({ label: String(row.stage || "").charAt(0) + String(row.stage || "").slice(1).toLowerCase(), value: Number(row.count || 0), color: `hsl(var(--chart-${(index % 8) + 1}))`, href: `/production/job-cards?stage=${row.stage}` }))}
        />
      </Card>
    ),
    commercial: (
      <Card key="commercial" title="Where the order book stands" subtitle={`${inr(Number(salesAggregates?.booked_value))} booked across all orders`} action={<CardLink href="/sales-orders">Orders</CardLink>}>
        <div className="space-y-5 pt-1">
          <StackedMeter
            total={Number(salesAggregates?.booked_value || 0)}
            format={(value) => inr(value)}
            parts={[
              { label: "Dispatched", value: Number(salesAggregates?.dispatched_value || 0), color: "hsl(var(--chart-7))" },
              { label: "Released, in production", value: Number(salesAggregates?.released_open_value || 0), color: "hsl(var(--chart-1))" },
              { label: "Not yet released", value: Math.max(0, Number(salesAggregates?.open_order_book_value || 0) - Number(salesAggregates?.released_open_value || 0)), color: "hsl(var(--chart-6))" },
            ]}
          />
          <div className="grid grid-cols-3 divide-x divide-border overflow-hidden rounded-lg border border-border text-center">
            {[
              ["Open qty", `${num(salesAggregates?.open_qty)} pcs`],
              ["On hold", `${num(salesAggregates?.hold_qty)} pcs`],
              ["Expired SOs", num(salesAggregates?.expired_open_count)],
            ].map(([label, value]) => (
              <div key={label} className="px-2 py-2.5"><p className="text-[11px] text-muted-foreground">{label}</p><p className="text-[14px] font-semibold tabular-nums">{value}</p></div>
            ))}
          </div>
        </div>
      </Card>
    ),
  }

  return (
    <div className="space-y-5" data-testid={testId || "workspace-role-landing"} data-role={role}>
      {analytics ? (
        <>
          {header}
          <div className="flex flex-wrap items-center gap-2">
            <div className="tube-segment max-sm:[&>button]:!h-11" role="group" aria-label="Period">
              {PERIODS.map(([value, label]) => (
                <button key={value} type="button" aria-pressed={period === value} onClick={() => setPeriod(value)}>{label}</button>
              ))}
            </div>
            <span className="text-[12.5px] text-muted-foreground">{dayjs(range.start_date).format("D MMM")} – {dayjs(range.end_date).format("D MMM YYYY")} · {displayPlantScope(activePlant, "all plants")}</span>
            <button type="button" className="tube-icon-button ml-auto !h-11 !w-11 border !border-border bg-card" aria-label="Refresh" title="Refresh" onClick={refresh}>
              <RefreshCw className={cn(fetching && "animate-spin")} />
            </button>
          </div>
        </>
      ) : (
      <section data-testid="page-header" className="cc-hero relative overflow-hidden rounded-2xl border border-border bg-card px-5 py-5 shadow-[var(--shadow-premium)] animate-enter-up sm:px-6">
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="mb-2 flex flex-wrap items-center gap-2"><span className="tube-page-eyebrow !mb-0">{LANDING_LABELS[role]}</span><span className="text-[12px] text-muted-foreground">{dayjs().format("dddd, D MMMM")}</span></p>
            <h1 className="text-balance text-[24px] font-semibold tracking-tight sm:text-[28px]">{greeting()}{greetName ? `, ${greetName}` : ""}</h1>
            <p className="mt-1 max-w-2xl text-[13.5px] leading-6 text-muted-foreground">
              {headline}
            </p>
            {ownerTabs ? (
              <div className="tube-segment mt-4 max-sm:[&>button]:!h-11" role="tablist" aria-label="Owner focus">
                <button type="button" role="tab" aria-selected={focus === "kpis"} data-state={focus === "kpis" ? "active" : undefined} onClick={() => setFocus("kpis")}><LayoutDashboard size={14} />Company KPIs</button>
                <button type="button" role="tab" aria-selected={focus === "actions"} data-state={focus === "actions" ? "active" : undefined} onClick={() => setFocus("actions")}><ListChecks size={14} />Action center{attention.length ? <span className="ml-1 rounded-full bg-signal-rose-soft px-1.5 text-[11px] font-bold text-signal-rose-ink">{attention.length}</span> : null}</button>
              </div>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {packReadable ? <div className="tube-segment max-sm:[&>button]:!h-11" role="group" aria-label="Period">
              {PERIODS.map(([value, label]) => (
                <button key={value} type="button" aria-pressed={period === value} onClick={() => setPeriod(value)}>{label}</button>
              ))}
            </div> : null}
            <button type="button" className="tube-icon-button !h-11 !w-11 border !border-border bg-card" aria-label="Refresh" title="Refresh" onClick={refresh}>
              <RefreshCw className={cn(fetching && "animate-spin")} />
            </button>
          </div>
        </div>
      </section>
      )}

      {ownerTabs && focus === "actions" ? <ActionCenter /> : (<>
      {analytics || ownerTabs ? null : (
        <section aria-label="Waiting on you">
          <WorkQueue />
        </section>
      )}

      {kpiKeys.length ? <section className="stagger grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-3 2xl:grid-cols-4" aria-label="Key figures">
        {kpiKeys.map((key) => {
          const kpi = kpis[key]
          const failed = (key in { orderBook: 1, bookedValue: 1, dispatchedValue: 1, expired: 1, holdQty: 1 } && salesQuery.isError) || (["activeCards", "overdue", "blocked", "qcHolds", "dispatchReady"].includes(key) && jobsQuery.isError) || (!["orderBook", "bookedValue", "dispatchedValue", "expired", "holdQty", "activeCards", "overdue", "blocked", "qcHolds", "dispatchReady"].includes(key) && (packQuery.isError || !packReadable))
          const loading = !kpi.ready && !failed
          return (
            <MetricCard
              key={key}
              label={kpi.label}
              value={failed ? "Not reported" : loading ? "…" : kpi.value}
              detail={failed ? "Source unavailable — not shown as zero" : kpi.detail}
              icon={kpi.icon}
              tone={kpi.tone}
              href={kpi.href}
              spark={!failed && kpi.spark && kpi.spark.some(Boolean) ? kpi.spark : undefined}
              progress={!failed && !loading ? kpi.progress ?? null : null}
            />
          )
        })}
      </section> : null}

      {analytics || ownerTabs ? (
        <section className="erp-panel rounded-xl p-4 sm:p-5" aria-label="Health gauges">
          <div className="mb-2 flex items-center justify-between"><h3 className="text-[14.5px] font-semibold tracking-tight">Operating health</h3><span className="text-[12px] text-muted-foreground">{dayjs(range.start_date).format("D MMM")} – {dayjs(range.end_date).format("D MMM")}</span></div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <RadialGauge label="On time, in full" value={pack.sales?.summary?.closed_orders ? Number(pack.sales.summary.otif_percent) : null} detail={`${num(pack.sales?.summary?.closed_orders)} closed orders`} color="hsl(var(--chart-3))" />
            <RadialGauge label="Schedule adherence" value={packReady ? Number(pack.production?.summary?.schedule_adherence_percent || 0) : null} detail="Stages on their planned day" color="hsl(var(--chart-6))" />
            <RadialGauge label="QC pass rate" value={pack.quality?.summary?.has_inspection_data ? Number(pack.quality.summary.pass_rate) : null} detail={`${num(pack.quality?.summary?.checked)} inspections`} color="hsl(var(--chart-7))" />
            <RadialGauge label="Order book delivered" value={Number(salesAggregates?.booked_value) ? (Number(salesAggregates?.dispatched_value || 0) / Number(salesAggregates.booked_value)) * 100 : null} detail="Dispatched ÷ booked value" color="hsl(var(--chart-1))" />
          </div>
        </section>
      ) : null}

      {charts.length ? (
        <div className="grid gap-4 xl:grid-cols-2">
          {charts.slice(0, 2).map((key) => chart[key])}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-3">
        {!packReadable ? (
          // Floor roles get their shortcuts once, here (no second list at the bottom, 30 Oct). Late orders and
          // blocked cards are the plant head's and planner's; what needs this person arrives under Latest for you.
          <Card title="Your work" subtitle="Log and check today's work. Anything handed to you arrives under Latest for you." className="xl:col-span-2 xl:self-start">
            {quick.length ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {quick.map((action) => (
                  <Link key={`${action.href}:${action.label}`} href={action.href} className="group flex min-h-14 items-center gap-3 rounded-lg border border-border bg-card px-3.5 py-2.5 transition hover:border-primary/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-accent text-accent-foreground"><ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" /></span>
                    <span className="min-w-0"><span className="block text-[13.5px] font-semibold text-foreground">{action.label}</span><span className="block text-[12px] leading-5 text-muted-foreground">{action.detail}</span></span>
                  </Link>
                ))}
              </div>
            ) : <p className="py-6 text-center text-[13px] text-muted-foreground">Your shortcuts appear here once the Owner gives your role its pages.</p>}
          </Card>
        ) : (
        <Card title="Needs attention" subtitle="Late orders, blocked cards, holds and short materials" className="xl:col-span-2" action={<CardLink href="/planning/overview">All exceptions</CardLink>}>
          {attention.length ? (
            <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
              {attention.slice(0, 8).map((row) => (
                <Link key={row.id} href={row.href} className="group flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-foreground/[.025]">
                  <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-md ring-1 ring-inset", row.tone === "rose" ? "bg-signal-rose-soft text-signal-rose-ink ring-signal-rose-line" : "bg-signal-amber-soft text-signal-amber-ink ring-signal-amber-line")}>
                    <AlertTriangle className="h-3.5 w-3.5" />
                  </span>
                  <span className="w-20 shrink-0 text-[11.5px] font-medium text-muted-foreground">{row.area}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold text-foreground group-hover:text-primary">{row.title}</span>
                    <span className="block truncate text-[12px] text-muted-foreground">{row.detail}</span>
                  </span>
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100" />
                </Link>
              ))}
            </div>
          ) : packQuery.isError ? (
            <div className="flex items-center gap-3 rounded-lg border border-signal-amber-line bg-signal-amber-soft px-4 py-4 text-[13px] text-signal-amber-ink">
              <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden="true" />
              <span>Late orders and blocked cards could not be loaded just now. Refresh in a minute, or open <Link href="/production/job-cards" className="font-semibold underline underline-offset-2">Job cards</Link> for live status.</span>
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-lg border border-signal-emerald-line bg-signal-emerald-soft px-4 py-4 text-[13px] text-signal-emerald-ink">
              <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden="true" />
              {packQuery.isLoading ? "Checking orders, cards, holds and stock…" : "No late orders, blocked cards, QC holds or short materials right now."}
            </div>
          )}
        </Card>
        )}
        {analytics ? (
          <Card title="Exception streams" subtitle="Live counts behind the attention list">
            <dl className="divide-y divide-border overflow-hidden rounded-lg border border-border text-[13px]">
              {[
                ["Late customer orders", Number(pack.sales?.summary?.delayed_orders || 0), "/reports/sales"],
                ["Blocked job cards", Number(pack.production?.summary?.blocked_jobs || 0), "/reports/operations"],
                ["Active QC holds", Number(pack.headline?.active_qc_holds || 0), "/reports/quality"],
                ["Materials below reorder", Number(inv.low_stock_count || 0), "/inventory/stock-alerts"],
                ["Expired sales orders", Number(salesAggregates?.expired_open_count || 0), "/sales-orders"],
              ].map(([label, value, href]) => (
                <Link key={String(label)} href={String(href)} className="flex items-center justify-between gap-3 px-3 py-2.5 transition-colors hover:bg-foreground/[.025]">
                  <dt className="text-foreground/85">{label}</dt>
                  <dd className={cn("rounded-full px-2 py-0.5 text-[12px] font-semibold tabular-nums", Number(value) ? "bg-signal-amber-soft text-signal-amber-ink" : "bg-signal-emerald-soft text-signal-emerald-ink")}>{num(Number(value))}</dd>
                </Link>
              ))}
            </dl>
          </Card>
        ) : (
        <Card title="Latest for you" subtitle="Handoffs and alerts routed to your role" action={<CardLink href="/inbox">Inbox</CardLink>}>
          {inboxItems.length ? (
            <div className="-mx-2 space-y-0.5">
              {inboxItems.slice(0, 5).map((item) => <InboxLine key={item.id} item={item} roles={userRoles} />)}
            </div>
          ) : <p className="py-8 text-center text-[13px] text-muted-foreground">{inbox.isLoading ? "Loading…" : "No notifications yet."}</p>}
        </Card>
        )}
      </div>

      {charts.length > 2 ? (
        <div className={cn("grid gap-4", charts.length - 2 >= 3 ? "xl:grid-cols-3" : "xl:grid-cols-2")}>
          {charts.slice(2, 5).map((key) => chart[key])}
        </div>
      ) : null}
      {charts.length > 5 ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{charts.slice(5).map((key) => chart[key])}</div> : null}

      {!analytics && packReadable && quick.length ? (
        <section aria-label="Shortcuts" className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
          {quick.map((action) => (
            <Link key={`${action.href}:${action.label}`} href={action.href} className="group flex items-start gap-3 rounded-xl border border-border bg-card px-3.5 py-3 shadow-[var(--shadow-xs)] transition hover:border-primary/30 hover:shadow-[var(--shadow-premium)]">
              <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md bg-accent text-accent-foreground"><ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" /></span>
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold">{action.label}</span>
                <span className="block text-[12px] leading-5 text-muted-foreground">{action.detail}</span>
              </span>
            </Link>
          ))}
        </section>
      ) : null}
      </>)}
    </div>
  )
}
