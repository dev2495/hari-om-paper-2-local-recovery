"use client"

import dayjs from "dayjs"
import Link from "next/link"
import { useMemo, useState, type ReactNode } from "react"
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
import { NotificationRow } from "@/components/workspace/notification-center"
import { WorkQueue } from "@/components/workspace/work-queue"
import { useAuth } from "@/context/AuthContext"
import { useOwnerPack } from "@/hooks/use-analytics"
import { useJobCardAggregates } from "@/hooks/use-production"
import { useSalesOrderAggregates } from "@/hooks/use-sales"
import { useCustomers } from "@/hooks/use-master-data"
import { useNotifications } from "@/hooks/use-workspace"
import { jobCardRef } from "@/lib/job-card-display"
import type { InboxNotification } from "@/lib/notifications"
import { displayPlantScope } from "@/lib/plant-scope"
import { cn } from "@/lib/utils"
import { LANDING_LABELS, LANDING_QUICK_ACTIONS, type LandingRole } from "@/lib/workspace"

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
  Operator: ["activeCards", "overdue", "produced", "qcHolds"],
}

type ChartKey = "output" | "orderFlow" | "pipeline" | "machines" | "quality" | "inventory" | "customers"
const ROLE_CHARTS: Record<LandingRole, ChartKey[]> = {
  Owner: ["orderFlow", "output", "pipeline", "inventory", "customers", "quality"],
  Admin: ["orderFlow", "output", "pipeline", "inventory"],
  PlantManager: ["output", "pipeline", "machines", "quality"],
  Planner: ["pipeline", "output", "machines", "orderFlow"],
  Sales: ["orderFlow", "customers"],
  QC: ["quality", "pipeline"],
  Store: ["inventory", "output"],
  Dispatch: ["orderFlow", "pipeline"],
  Operator: ["pipeline", "output"],
}

const STAGE_ORDER = ["SLITTING", "WINDER", "OVEN", "PROCESS", "PACKING", "QC", "DISPATCH"]
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
  return (
    <Link href={href} className="group inline-flex shrink-0 items-center gap-1 text-[12.5px] font-medium text-primary">
      {children}
      <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
    </Link>
  )
}

/**
 * One command center for every role: same data, shaped per job. Every number comes
 * from a server aggregate or the analytics owner pack for the chosen period; a failed
 * source renders "Not reported", never zero.
 */
const ANALYTICS_KPIS: KpiKey[] = ["orderBook", "bookedValue", "dispatchedValue", "otif", "leadTime", "dispatchQty", "produced", "activeCards", "overdue", "adherence", "utilization", "qcPass", "inventoryValue", "blocked"]
const ANALYTICS_CHARTS: ChartKey[] = ["orderFlow", "output", "pipeline", "machines", "quality", "inventory", "customers"]

export function CommandCenter({ role, testId, variant = "landing", header }: { role: LandingRole; testId?: string; variant?: "landing" | "analytics"; header?: ReactNode }) {
  const analytics = variant === "analytics"
  const { user, activePlant } = useAuth()
  const [period, setPeriod] = useState<Period>("30d")
  const range = useMemo(() => periodRange(period), [period])
  const packParams = useMemo(() => ({ ...range, ...(activePlant ? { plant: activePlant } : {}) }), [range, activePlant])
  const packQuery = useOwnerPack(packParams)
  const salesQuery = useSalesOrderAggregates()
  const jobsQuery = useJobCardAggregates()
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
  const pipelineRows = (Array.isArray(pack.production?.stage_pipeline) ? pack.production.stage_pipeline : [])
    .map((row: any) => ({ stage: String(row.stage_type || "").toUpperCase(), count: Number(row.count || 0) }))
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
    orderBook: { label: "Open order book", value: inr(Number(salesAggregates?.open_order_book_value)), detail: `${num(salesAggregates?.open_order_count)} open orders · ${num(salesAggregates?.open_qty)} pcs`, icon: IndianRupee, tone: "teal", href: "/sales-orders/pending", ready: has(salesAggregates?.open_order_book_value) },
    bookedValue: { label: "Booked value", value: inr(Number(salesAggregates?.booked_value)), detail: `${num(salesAggregates?.total_order_count)} orders booked, all time`, icon: IndianRupee, tone: "blue", href: "/sales-orders?status=all", ready: has(salesAggregates?.booked_value) },
    dispatchedValue: { label: "Dispatched value", value: inr(Number(salesAggregates?.dispatched_value)), detail: "Fulfilled quantity × line rate, all time", icon: Truck, tone: "emerald", href: "/reports/dispatch", ready: has(salesAggregates?.dispatched_value) },
    dispatchQty: { label: "Dispatched in period", value: `${num(pack.dispatch?.summary?.dispatch_qty)} pcs`, detail: `${num(pack.dispatch?.summary?.closed_orders)} orders closed`, icon: PackageCheck, tone: "cyan", spark: spark("dispatch_qty", orderSeries), href: "/reports/dispatch", ready: packReady },
    otif: { label: "On time, in full", value: pack.sales?.summary?.closed_orders ? pct(Number(pack.sales?.summary.otif_percent)) : "No closures", detail: `${num(pack.sales?.summary?.closed_orders)} closed orders measured`, icon: Gauge, tone: "violet", progress: pack.sales?.summary?.closed_orders ? Number(pack.sales?.summary.otif_percent) : null, href: "/reports/sales", ready: packReady },
    leadTime: { label: "Release → dispatch", value: pack.sales?.summary?.release_to_dispatch_days ? `${num(pack.sales?.summary.release_to_dispatch_days, 1)} days` : "—", detail: "Average order lead time on closed orders", icon: CalendarClock, tone: "blue", ready: packReady },
    activeCards: { label: "Open job cards", value: num(jobs.open_cards), detail: `${num(jobs.due_priority)} due soon · ${num(jobs.completed_cards)} completed`, icon: Factory, tone: "blue", href: "/production/job-cards", ready: has(jobs.open_cards) },
    overdue: { label: "Overdue job cards", value: num(jobs.due_overdue), detail: jobs.overdue_label || "Past their promised date", icon: TimerOff, tone: Number(jobs.due_overdue) ? "rose" : "slate", href: "/production/job-cards?due=overdue", ready: has(jobs.due_overdue) },
    blocked: { label: "Blocked cards", value: num(jobs.blocked), detail: "Waiting on material, machine or a decision", icon: ShieldAlert, tone: Number(jobs.blocked) ? "rose" : "slate", href: "/planning/tracker", ready: has(jobs.blocked) },
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

  const charts = analytics ? ANALYTICS_CHARTS : ROLE_CHARTS[role]
  const kpiKeys = analytics ? ANALYTICS_KPIS : ROLE_KPIS[role]
  const firstName = String(user?.name || "").split(/\s+/)[0]
  const inboxItems = (Array.isArray(inbox.data?.items) ? inbox.data.items : []) as InboxNotification[]
  const quick = LANDING_QUICK_ACTIONS[role] || []

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
      <Card key="pipeline" title="Where open work is" subtitle="Open job cards by current stage" action={<CardLink href="/planning/tracker">Tracker</CardLink>}>
        {pipelineRows.length ? (
          <div className="space-y-2">
            {pipelineRows.map((row: any, index: number) => {
              const max = Math.max(1, ...pipelineRows.map((item: any) => item.count))
              return (
                <Link key={row.stage} href={`/production/job-cards?stage=${row.stage}`} className="group block">
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
      <Card key="customers" title="Largest open orders by customer" subtitle="Open order value, server totals" action={<CardLink href="/sales-orders/pending">Pending</CardLink>}>
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
  }

  return (
    <div className="space-y-5" data-testid={testId || "workspace-role-landing"} data-role={role}>
      {analytics ? (
        <>
          {header}
          <div className="flex flex-wrap items-center gap-2">
            <div className="tube-segment" role="group" aria-label="Period">
              {PERIODS.map(([value, label]) => (
                <button key={value} type="button" aria-pressed={period === value} onClick={() => setPeriod(value)}>{label}</button>
              ))}
            </div>
            <span className="text-[12.5px] text-muted-foreground">{dayjs(range.start_date).format("D MMM")} – {dayjs(range.end_date).format("D MMM YYYY")} · {displayPlantScope(activePlant, "all plants")}</span>
            <button type="button" className="tube-icon-button ml-auto border !border-border bg-card" aria-label="Refresh" title="Refresh" onClick={() => { void packQuery.refetch(); void salesQuery.refetch(); void jobsQuery.refetch() }}>
              <RefreshCw className={cn(fetching && "animate-spin")} />
            </button>
          </div>
        </>
      ) : (
      <section data-testid="page-header" className="cc-hero relative overflow-hidden rounded-2xl border border-border bg-card px-5 py-5 shadow-[var(--shadow-premium)] animate-enter-up sm:px-6">
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="mb-2 flex flex-wrap items-center gap-2"><span className="tube-page-eyebrow !mb-0">{LANDING_LABELS[role]}</span><span className="text-[12px] text-muted-foreground">{dayjs().format("dddd, D MMMM")}</span></p>
            <h1 className="text-[24px] font-semibold tracking-tight sm:text-[28px]">{greeting()}{firstName ? `, ${firstName}` : ""}</h1>
            <p className="mt-1 max-w-2xl text-[13.5px] leading-6 text-muted-foreground">
              {attention.length
                ? `${attention.length} item${attention.length === 1 ? "" : "s"} need attention across orders, production, quality and stock in ${displayPlantScope(activePlant, "all plants")}.`
                : `Nothing is late or blocked in ${displayPlantScope(activePlant, "all plants")}. Here is how the period is going.`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="tube-segment" role="group" aria-label="Period">
              {PERIODS.map(([value, label]) => (
                <button key={value} type="button" aria-pressed={period === value} onClick={() => setPeriod(value)}>{label}</button>
              ))}
            </div>
            <button type="button" className="tube-icon-button border !border-border bg-card" aria-label="Refresh" title="Refresh" onClick={() => { void packQuery.refetch(); void salesQuery.refetch(); void jobsQuery.refetch() }}>
              <RefreshCw className={cn(fetching && "animate-spin")} />
            </button>
          </div>
        </div>
      </section>
      )}

      {analytics ? null : (
        <section aria-label="Waiting on you">
          <WorkQueue />
        </section>
      )}

      <section className={cn("stagger grid gap-3 sm:grid-cols-2", kpiKeys.length > 4 ? "xl:grid-cols-4" : "xl:grid-cols-4")} aria-label="Key figures">
        {kpiKeys.map((key) => {
          const kpi = kpis[key]
          const failed = (key in { orderBook: 1, bookedValue: 1, dispatchedValue: 1, expired: 1, holdQty: 1 } && salesQuery.isError) || (["activeCards", "overdue", "blocked", "qcHolds", "dispatchReady"].includes(key) && jobsQuery.isError) || (!["orderBook", "bookedValue", "dispatchedValue", "expired", "holdQty", "activeCards", "overdue", "blocked", "qcHolds", "dispatchReady"].includes(key) && packQuery.isError)
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
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        {charts.slice(0, 2).map((key) => chart[key])}
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Needs attention" subtitle="Late orders, blocked cards, holds and short materials" className="xl:col-span-2" action={<CardLink href="/planning/tracker">All exceptions</CardLink>}>
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
          ) : (
            <div className="flex items-center gap-3 rounded-lg border border-signal-emerald-line bg-signal-emerald-soft px-4 py-4 text-[13px] text-signal-emerald-ink">
              <CheckCircle2 className="h-5 w-5 shrink-0" />
              {packQuery.isLoading ? "Checking orders, cards, holds and stock…" : packQuery.isError ? "Exceptions could not be loaded from analytics. Open the tracker for live status." : "No late orders, blocked cards, QC holds or short materials right now."}
            </div>
          )}
        </Card>
        {analytics ? (
          <Card title="Exception streams" subtitle="Live counts behind the attention list">
            <dl className="divide-y divide-border overflow-hidden rounded-lg border border-border text-[13px]">
              {[
                ["Late customer orders", Number(pack.sales?.summary?.delayed_orders || 0), "/reports/sales"],
                ["Blocked job cards", Number(pack.production?.summary?.blocked_jobs || 0), "/reports/operations"],
                ["Active QC holds", Number(pack.headline?.active_qc_holds || 0), "/reports/quality"],
                ["Materials below reorder", Number(inv.low_stock_count || 0), "/analytics/mrp"],
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
            <div className="-mx-2">
              {inboxItems.slice(0, 5).map((item) => (
                <Link key={item.id} href={item.href || "/inbox"} className="block">
                  <NotificationRow item={item} onOpen={() => undefined} onToggleRead={() => undefined} compact />
                </Link>
              ))}
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
      {charts.length > 5 ? <div className="grid gap-4 xl:grid-cols-2">{charts.slice(5).map((key) => chart[key])}</div> : null}

      {!analytics && quick.length ? (
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
    </div>
  )
}
