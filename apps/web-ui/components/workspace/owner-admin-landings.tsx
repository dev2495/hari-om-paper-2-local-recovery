"use client"

import Link from "next/link"
import { useMemo } from "react"
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  ClipboardCheck,
  Factory,
  Gauge,
  Layers3,
  ShieldCheck,
  Truck,
  Users,
  Workflow,
  Wrench,
} from "lucide-react"
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts"

import { AreaTrend, ChartCard, CompactTable, FilterChip, InsightStrip, KpiCard, MiniBarList, PageIntro, formatCompactCurrency, formatCompactNumber, formatPercent } from "@/components/erp/premium-dashboard"
import { useAuth } from "@/context/AuthContext"
import { useOwnerPack } from "@/hooks/use-analytics"
import { useInventoryHealthSummary } from "@/hooks/use-inventory"
import { useCustomers } from "@/hooks/use-master-data"
import { usePlanningBoard } from "@/hooks/use-production"
import { useSalesOrders } from "@/hooks/use-sales"
import { useAuditEvents, useSystemHealth } from "@/hooks/use-workspace"
import { jobCardRef } from "@/lib/job-card-display"
import { displayPlantScope } from "@/lib/plant-scope"

function buildSparkline(values: number[]) {
  return values.map((value, index) => ({ label: `P${index + 1}`, value: Number(value || 0) }))
}

function safeSeries(raw: any[]) {
  return (Array.isArray(raw) ? raw : []).map((row: any, index: number) => ({
    label: row.bucket || row.date || row.label || `P${index + 1}`,
    winder: Number(row.winder_qty || 0),
    oven: Number(row.oven_qty || 0),
    process: Number(row.process_qty || 0),
    dispatch: Number(row.dispatch_qty || 0),
    otif: Number(row.otif_percent || row.otif || 0),
  }))
}

function openSalesValue(order: any) {
  return (Array.isArray(order?.lines) ? order.lines : []).reduce(
    (sum: number, line: any) => sum + Math.max(0, Number(line.qty || 0) - Number(line.fulfilled_qty || 0)) * Number(line.rate_per_pc || 0),
    0,
  )
}

function looksLikeUuid(value: unknown) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || "").trim())
}

export function OwnerLandingPage() {
  const { activePlant } = useAuth()
  const { data: ownerPack } = useOwnerPack(activePlant ? { plant: activePlant } : undefined, { enabled: true })
  const { data: salesOrders } = useSalesOrders()
  const { data: customers } = useCustomers()
  const { data: inventoryHealth } = useInventoryHealthSummary()
  const { data: planningBoard } = usePlanningBoard(undefined, undefined, true, activePlant || undefined, true)

  const orders = useMemo(() => (Array.isArray(salesOrders) ? salesOrders : []), [salesOrders])
  const customerById = useMemo(() => {
    const rows = Array.isArray(customers) ? customers : []
    return new Map(rows.map((customer: any) => [String(customer.id), String(customer.name || customer.customer_name || customer.code || customer.id)]))
  }, [customers])
  const pack: any = ownerPack || {}
  const headline = pack.headline || {}
  const series = safeSeries(pack.production?.series || [])
  const commercial = useMemo(() => orders.reduce(
    (totals: { booked: number; open: number; releasedOpen: number; dispatched: number }, order: any) => {
      for (const line of Array.isArray(order.lines) ? order.lines : []) {
        const rate = Number(line.rate_per_pc || 0)
        const qty = Number(line.qty || 0)
        const fulfilled = Math.min(qty, Number(line.fulfilled_qty || 0))
        const released = Math.min(qty, Number(line.released_qty || 0))
        totals.booked += qty * rate
        totals.open += Math.max(0, qty - fulfilled) * rate
        totals.releasedOpen += Math.max(0, released - fulfilled) * rate
        totals.dispatched += fulfilled * rate
      }
      return totals
    },
    { booked: 0, open: 0, releasedOpen: 0, dispatched: 0 },
  ), [orders])
  const orderBookValue = commercial.open
  const recentSeries = series.slice(-10).map((row) => ({ ...row, otifTarget: 92 }))
  const topCustomers = useMemo(() => {
    const map = new Map<string, number>()
    for (const order of orders) {
      const rawName = order.customer_name
      const mappedName = customerById.get(String(order.customer_id || order.customerId || rawName || ""))
      const customer = String(
        (!looksLikeUuid(rawName) ? rawName : null) ||
          mappedName ||
          order.customer_code ||
          String(order.customer_id || "Unassigned customer"),
      )
      map.set(customer, (map.get(customer) || 0) + openSalesValue(order))
    }
    return Array.from(map.entries())
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5)
  }, [customerById, orders])
  const delayedOrders = Array.isArray(pack.sales?.delayed_rows) ? pack.sales.delayed_rows : []
  const blockedRows = Array.isArray(pack.production?.blocked_rows) ? pack.production.blocked_rows : []
  const lowStockRows = Array.isArray(pack.inventory?.risk_items?.low_stock) ? pack.inventory.risk_items.low_stock : []
  const activeHolds = Array.isArray(pack.exceptions?.active_holds) ? pack.exceptions.active_holds : []
  const boardStages = Array.isArray(planningBoard?.stages) ? planningBoard.stages : []
  const stageRowsRaw = boardStages.map((stage: any) => ({
    label: String(stage.stage || stage.stage_type || "Stage"),
    value: (Array.isArray(stage.lanes) ? stage.lanes : []).reduce((sum: number, lane: any) => sum + Number(lane?.jobs?.length || 0), 0),
  }))
  const stageRows = stageRowsRaw
  const openOrderCount = orders.filter((order: any) => openSalesValue(order) > 0).length
  const waterfall = [
    { label: "Booked", value: commercial.booked },
    { label: "Open", value: commercial.open },
    { label: "Released open", value: commercial.releasedOpen },
    { label: "Dispatched", value: Number(headline.dispatch_value ?? commercial.dispatched) },
  ]
  const plantMix = (Array.isArray(pack.plant_compare) ? pack.plant_compare : [])
    .map((row: any) => ({
      label: row.plant_name || row.plant_code || row.plant_id || "Plant",
      value: Number(row.inventory_value || row.job_cards || 0),
    }))
    .slice(0, 4)
  const insights = [
    delayedOrders.length
      ? { id: "delayed", tone: "critical" as const, title: `${delayedOrders.length} sales orders are overdue for dispatch handoff.`, action: "Open sales" }
      : null,
    blockedRows.length
      ? { id: "blocked", tone: "warn" as const, title: `${blockedRows.length} live job cards are blocked on the execution spine.`, action: "Open tracker" }
      : null,
    lowStockRows.length
      ? { id: "stock", tone: "warn" as const, title: `${lowStockRows.length} materials are under reorder or safety level.`, action: "Open MRP" }
      : null,
  ].filter(Boolean) as Array<{ id: string; tone?: "good" | "warn" | "critical"; title: string; action?: string }>

  return (
    <div className="space-y-5" data-testid="landing-owner-page">
      <PageIntro
        eyebrow="Owner Landing"
        title="Board-level manufacturing pulse with revenue posture, WIP stress, and dispatch risk in one read."
        description="This landing is tuned for the owner’s daily scan: what is moving, what is blocked, where money is sitting, and which issues need intervention now."
        actions={
          <>
            <FilterChip active>MTD</FilterChip>
            <FilterChip>{displayPlantScope(activePlant, "All plants")}</FilterChip>
          </>
        }
        aside={
          <div className="space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-200">Morning brief</p>
            <p className="text-2xl font-semibold tracking-tight">
              {delayedOrders.length
                ? `OTIF has slipped and ${delayedOrders.length} commitments need eyes today.`
                : "No red-flag commercial slips detected in the current window."}
            </p>
            <p className="text-sm leading-6 text-slate-300">
              Open order book {formatCompactCurrency(orderBookValue)}. Dispatch posture {formatCompactNumber(Number(headline.dispatch_qty || 0))} kg in the selected window.
            </p>
          </div>
        }
      />

      <InsightStrip items={insights} />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <KpiCard label="Dispatched Value" value={formatCompactCurrency(Number(headline.dispatch_value ?? commercial.dispatched))} detail="Fulfilled quantity multiplied by the sales-line rate" icon={BarChart3} tone="cyan" sparkline={recentSeries.length ? buildSparkline(recentSeries.map((row) => row.dispatch)) : undefined} />
        <KpiCard label="Open Order Book" value={formatCompactCurrency(orderBookValue)} detail={`${openOrderCount} sales orders with quantity remaining`} icon={Workflow} tone="amber" />
        <KpiCard label="Inventory Value" value={formatCompactCurrency(Number(headline.inventory_value ?? inventoryHealth?.summary?.total_value ?? 0))} detail={`${formatCompactNumber(Number(headline.active_job_cards || 0))} active job cards across the route`} icon={Factory} tone="violet" sparkline={recentSeries.length ? buildSparkline(recentSeries.map((row) => row.winder + row.oven + row.process)) : undefined} />
        <KpiCard label="OTIF" value={formatPercent(Number(headline.otif_percent || 0))} detail="Closed orders on-time and in-full" icon={Gauge} tone={Number(headline.otif_percent || 0) >= 92 ? "emerald" : "rose"} delta={{ value: Math.abs(92 - Number(headline.otif_percent || 0)), suffix: "pp", positive: Number(headline.otif_percent || 0) >= 92, label: "vs 92% target" }} sparkline={recentSeries.length ? buildSparkline(recentSeries.map((row) => row.otif)) : undefined} />
        <KpiCard label="Blocked Jobs" value={formatCompactNumber(blockedRows.length || Number(headline.blocked_jobs || 0))} detail="Job cards waiting on floor or approval intervention" icon={AlertTriangle} tone={(blockedRows.length || Number(headline.blocked_jobs || 0)) > 0 ? "rose" : "emerald"} />
        <KpiCard label="Consumption Variance" value={formatCompactCurrency(Number(pack.reconciliation?.summary?.variance_value || 0))} detail="Actual material variance from reconciliation" icon={Layers3} tone="slate" />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <ChartCard eyebrow="Commercial Flow" title="Booked to dispatched value" description="Values calculated from real sales-line quantity, fulfilled quantity, released quantity, and rate.">
          <AreaTrend rows={waterfall} dataKey="value" color="#0891b2" />
        </ChartCard>
        <ChartCard eyebrow="Top Customers" title="Customer share of the current order book" description="Commercial concentration by open order value.">
          <MiniBarList rows={topCustomers} formatter={(value) => formatCompactCurrency(value)} />
          <div className="mt-4">
            <Link href="/sales-orders" className="inline-flex items-center gap-2 text-sm font-semibold text-cyan-900">
              Open sales orders <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </ChartCard>
      </section>

      <section className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <ChartCard eyebrow="Operations" title="Live stage load" description="Planner board load grouped by stage from the current board snapshot.">
          <MiniBarList rows={stageRows} formatter={(value) => `${formatCompactNumber(value)} JCs`} />
        </ChartCard>
        <ChartCard eyebrow="OTIF Trend" title="Daily execution confidence" description="Recent OTIF movement against the target threshold.">
          {recentSeries.length ? <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={recentSeries}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip formatter={(value: number) => [formatPercent(value), "OTIF"]} contentStyle={{ borderRadius: 14, border: "1px solid #e2e8f0" }} />
                <Line type="monotone" dataKey="otif" stroke="#be123c" strokeWidth={2.5} dot={false} />
                <Line type="monotone" dataKey="otifTarget" stroke="#0f172a" strokeDasharray="6 6" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div> : <p className="rounded-2xl bg-slate-50 p-5 text-sm text-slate-600">No production or dispatch events exist in the selected period.</p>}
        </ChartCard>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <ChartCard eyebrow="Needs Your Eyes" title="Action queue" description="Shortage, quality, and delayed demand that needs owner-level review.">
          <CompactTable
            columns={[
              { key: "kind", label: "Area" },
              { key: "title", label: "Issue" },
              { key: "detail", label: "Detail" },
            ]}
            rows={[
              ...delayedOrders.slice(0, 3).map((row: any) => ({
                kind: "Sales",
                title: row.order_no || row.id || "Delayed order",
                detail: `${row.customer_name || "Customer"} due ${row.due_date || "-"}`,
              })),
              ...blockedRows.slice(0, 3).map((row: any) => ({
                kind: "Production",
                title: jobCardRef(row),
                detail: `${row.current_stage || "Stage"} · ${row.customer_name || "Customer"}`,
              })),
              ...lowStockRows.slice(0, 2).map((row: any) => ({
                kind: "Supply",
                title: row.name || row.item_code || "Low stock",
                detail: `${formatCompactNumber(Number(row.available_qty || 0))} available`,
              })),
              ...activeHolds.slice(0, 2).map((row: any) => ({
                kind: "Quality",
                title: row.reason || "Active hold",
                detail: row.job_card_id || row.id || "-",
              })),
            ]}
            emptyLabel="No owner-level exceptions are currently raised."
          />
        </ChartCard>
        <ChartCard eyebrow="Dispatch & Plant Mix" title="Next handoff and plant contribution" description="Short-range dispatch view and plant contribution mix.">
          {plantMix.length ? <MiniBarList rows={plantMix} formatter={(value) => formatCompactCurrency(value)} /> : <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">No plant-comparison records exist in the selected period.</p>}
          <div className="mt-5 rounded-[1.35rem] border border-slate-200 bg-slate-50 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">Dispatch next 7 days</p>
            <p className="mt-2 text-2xl font-semibold text-slate-950">{formatCompactNumber(Number(pack.dispatch?.summary?.ready_job_count || 0))} ready jobs</p>
            <p className="mt-1 text-sm text-slate-500">Use the dispatch desk for sequence and challan generation.</p>
            <Link href="/logistics/dispatch" className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-cyan-900">
              Open dispatch <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </ChartCard>
      </section>
    </div>
  )
}

export function AdminLandingPage() {
  const { activePlant } = useAuth()
  const { data: systemHealth, isLoading: healthLoading, error: healthError } = useSystemHealth(true)
  const { data: auditEvents } = useAuditEvents({ since_hours: 72, limit: 8 })

  const services = Array.isArray(systemHealth?.services) ? systemHealth.services : []
  const summary = systemHealth?.summary || {}
  const runtime = systemHealth?.runtime || {}
  const schedulerJobs = Object.entries(systemHealth?.scheduler?.jobs || {}).map(([name, value]: [string, any]) => ({
    label: name.replaceAll("_", " "),
    value: ["OK", "SCHEDULED", "QUEUED", "DUPLICATE"].includes(String(value?.status || "").toUpperCase()) ? 100 : 0,
    hint: value?.last_error || systemHealth?.scheduler?.next_runs?.[name] || value?.status || "No run recorded",
  }))
  const auditRows = (Array.isArray(auditEvents?.items) ? auditEvents.items : []).slice(0, 8).map((row: any, index: number) => ({
    id: row.id || index,
    ts: row.occurred_at || "-",
    actor: row.actor_email || row.actor_role || row.source_service || "system",
    action: row.summary || row.event_type,
  }))
  const systemStatus = healthError ? "Unavailable" : healthLoading ? "Checking" : String(systemHealth?.status || "Unknown")
  const systemHealthy = systemStatus === "HEALTHY"
  const infrastructureRows = [
    runtime?.memory?.used_percent != null ? { label: "Memory used %", value: Number(runtime.memory.used_percent), hint: "Measured from the runtime cgroup" } : null,
    runtime?.storage?.used_percent != null ? { label: "Storage used %", value: Number(runtime.storage.used_percent), hint: "Measured from the application filesystem" } : null,
    runtime?.load_1m != null ? { label: "Load average 1m", value: Number(runtime.load_1m), hint: "Current process-host load" } : null,
  ].filter(Boolean) as Array<{ label: string; value: number; hint: string }>
  const integrityRows = [
    ...services.map((service: any) => ({
      check: `${service.name} health endpoint`,
      status: service.status,
      detail: service.status === "UP" ? `HTTP ${service.http_status} in ${service.latency_ms} ms` : service.detail || "Probe failed",
    })),
    {
      check: "Analytics scheduler",
      status: systemHealth?.scheduler?.enabled ? "UP" : "DOWN",
      detail: systemHealth?.scheduler ? `${Object.keys(systemHealth.scheduler.jobs || {}).length} jobs registered; queue ${systemHealth.scheduler.queue?.available === false ? "unavailable" : "available"}` : "Scheduler status unavailable",
    },
  ]

  return (
    <div className="space-y-5" data-testid="landing-admin-page">
      <PageIntro
        eyebrow="Admin Landing"
        title="System health, integrity checks, session visibility, and fast-control actions for the ERP platform."
        description="This is the admin control surface: service posture, data integrity, jobs, sessions, and the audit trail that proves what changed."
        actions={
          <>
            <FilterChip active>Last 1h</FilterChip>
            <FilterChip>{displayPlantScope(activePlant, "All plants")}</FilterChip>
          </>
        }
        aside={
          <div className="space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-200">Status banner</p>
            <p className="text-2xl font-semibold tracking-tight">
              System {systemStatus.toLowerCase()}, {formatCompactNumber(Number(summary.services_up || 0))} of {formatCompactNumber(Number(summary.services_total || 0))} service probes passing.
            </p>
            <p className="text-sm leading-6 text-slate-300">
              Last measured {systemHealth?.checked_at ? new Date(systemHealth.checked_at).toLocaleString("en-IN") : "not yet"}; maximum current probe latency {formatCompactNumber(Number(summary.max_probe_latency_ms || 0))} ms.
            </p>
          </div>
        }
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="System Status" value={systemStatus} detail={systemHealthy ? "All measured service probes pass" : "One or more measured checks need attention"} icon={ShieldCheck} tone={systemHealthy ? "emerald" : "rose"} />
        <KpiCard label="Max Probe Latency" value={`${formatCompactNumber(Number(summary.max_probe_latency_ms || 0))} ms`} detail="Slowest current service health probe" icon={Gauge} tone="cyan" />
        <KpiCard label="Failed Probes" value={formatCompactNumber(Number(summary.failed_probes || 0))} detail="Current dependency health failures" icon={AlertTriangle} tone={Number(summary.failed_probes || 0) ? "rose" : "emerald"} />
        <KpiCard label="Active Accounts" value={summary.active_accounts == null ? "Unknown" : formatCompactNumber(Number(summary.active_accounts))} detail="Enabled user accounts; live sessions are not inferred" icon={Users} tone="violet" />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <ChartCard eyebrow="Services" title="Service posture and runtime risk" description="Live summary of the core application surfaces.">
          <CompactTable
            columns={[
              { key: "name", label: "Service" },
              { key: "status", label: "Status" },
              { key: "latency_ms", label: "Probe ms" },
              { key: "http_status", label: "HTTP" },
            ]}
            rows={services}
          />
        </ChartCard>
        <ChartCard eyebrow="Infrastructure" title="Host and workload health" description="Foundational platform checks and integrity signals.">
          {infrastructureRows.length ? <MiniBarList rows={infrastructureRows} formatter={(value) => formatCompactNumber(value)} /> : <p className="text-sm text-slate-600">Runtime metrics are unavailable.</p>}
        </ChartCard>
      </section>

      <section className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <ChartCard eyebrow="Dependency Integrity" title="Measured platform checks" description="Current health endpoints and scheduler state; no unmeasured database claims are shown.">
          <CompactTable
            columns={[
              { key: "check", label: "Check" },
              { key: "status", label: "Status" },
              { key: "detail", label: "Detail" },
            ]}
            rows={integrityRows}
          />
        </ChartCard>
        <ChartCard eyebrow="Audit Tail" title="Recent activity and admin actions" description="Recent workspace events from the notification trail.">
          <CompactTable
            columns={[
              { key: "ts", label: "Time" },
              { key: "actor", label: "Actor" },
              { key: "action", label: "Action" },
            ]}
            rows={auditRows}
            emptyLabel="No audit-like activity is currently available."
          />
        </ChartCard>
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <ChartCard eyebrow="Background Jobs" title="Job schedule posture" description="Operational jobs and platform recomputes.">
          {schedulerJobs.length ? <MiniBarList rows={schedulerJobs} formatter={(value) => `${formatCompactNumber(value)}%`} /> : <p className="text-sm text-slate-600">No scheduler job status was returned.</p>}
        </ChartCard>
        <ChartCard eyebrow="Accounts" title="Access visibility" description="Account data is measured separately from sessions.">
          <p className="text-3xl font-semibold text-slate-950">{summary.active_accounts == null ? "Unknown" : formatCompactNumber(Number(summary.active_accounts))}</p>
          <p className="mt-2 text-sm leading-6 text-slate-600">Enabled accounts reported by auth-service. The stack does not fabricate a current session count.</p>
        </ChartCard>
        <ChartCard eyebrow="Quick Actions" title="Admin control points" description="Navigate to the highest-value admin actions already present in the ERP.">
          <div className="space-y-3">
            {[
              { href: "/system/users", label: "Role matrix", icon: Users },
              { href: "/system/tolerances", label: "Variance tolerances", icon: Wrench },
              { href: "/system/scheduler", label: "Scheduler status", icon: Wrench },
              { href: "/masters/reason-codes", label: "Reason codes", icon: ClipboardCheck },
              { href: "/masters/employees", label: "Employees", icon: Users },
              { href: "/masters/shifts", label: "Shifts", icon: Wrench },
              { href: "/masters/holidays", label: "Plant calendar", icon: Wrench },
              { href: "/operations/control", label: "Operations control", icon: Wrench },
              { href: "/reports", label: "Report hub", icon: ClipboardCheck },
              { href: "/analytics", label: "Analytics", icon: BarChart3 },
              { href: "/planning/tracker", label: "Tracker", icon: Wrench },
            ].map((item) => (
              <Link key={item.href} href={item.href} className="flex items-center justify-between rounded-[1.2rem] border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                <span className="inline-flex items-center gap-2">
                  <item.icon className="h-4 w-4 text-cyan-800" />
                  {item.label}
                </span>
                <ArrowRight className="h-4 w-4 text-slate-400" />
              </Link>
            ))}
          </div>
        </ChartCard>
      </section>
    </div>
  )
}
