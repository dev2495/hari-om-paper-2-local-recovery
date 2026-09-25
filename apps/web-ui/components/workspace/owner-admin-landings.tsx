"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { ErrorState, LoadingState } from "@/components/workspace/query-state"
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
import { useSalesOrderAggregates } from "@/hooks/use-sales"
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

export function OwnerLandingPage() {
  const { activePlant } = useAuth()
  const router = useRouter()
  const { data: ownerPack, isLoading: packLoading, error: packError, refetch: retryPack } = useOwnerPack(activePlant ? { plant: activePlant } : undefined, { enabled: true })
  const { data: salesAggregates, isLoading: salesLoading, error: salesError, refetch: retrySales } = useSalesOrderAggregates()
  const { data: customers } = useCustomers()
  const { data: inventoryHealth } = useInventoryHealthSummary()
  const { data: planningBoard, isLoading: planningLoading, error: planningError } = usePlanningBoard(undefined, undefined, true, activePlant || undefined, true)

  const customerById = useMemo(() => {
    const rows = Array.isArray(customers) ? customers : []
    return new Map(rows.map((customer: any) => [String(customer.id), String(customer.name || customer.customer_name || customer.code || customer.id)]))
  }, [customers])
  const pack: any = ownerPack || {}
  const headline = pack.headline || {}
  const series = safeSeries(pack.production?.series || [])
  const bookedValue = Number(salesAggregates?.booked_value || 0)
  const orderBookValue = Number(salesAggregates?.open_order_book_value || 0)
  const releasedOpenValue = Number(salesAggregates?.released_open_value || 0)
  const dispatchedValue = Number(salesAggregates?.dispatched_value ?? headline.dispatch_value ?? 0)
  const recentSeries = series.slice(-10)
  const topCustomers = useMemo(() => {
    return (Array.isArray(salesAggregates?.open_value_by_customer) ? salesAggregates.open_value_by_customer : []).map((row: any) => ({
      label: customerById.get(String(row.customer_id)) || String(row.customer_id || "Customer"),
      value: Number(row.open_value || 0),
    }))
  }, [customerById, salesAggregates])
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
  const openOrderCount = Number(salesAggregates?.open_order_count || 0)
  const waterfall = [
    { label: "Booked", value: bookedValue },
    { label: "Open", value: orderBookValue },
    { label: "Released open", value: releasedOpenValue },
    { label: "Dispatched", value: dispatchedValue },
  ]
  const plantMix = (Array.isArray(pack.plant_compare) ? pack.plant_compare : [])
    .filter((row: any) => row.inventory_value != null)
    .map((row: any) => ({
      label: row.plant_name || row.plant_code || row.plant_id || "Plant",
      value: Number(row.inventory_value || 0),
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

  if (packLoading || salesLoading) return <LoadingState label="Loading the manufacturing overview…" />
  if (packError || salesError) return <ErrorState title="Overview data is unavailable" message="The order book or manufacturing summary could not be refreshed. Metrics are not shown as zero when a source fails." onRetry={() => { void retryPack(); void retrySales() }} />
  const metric = (value: unknown, format: (value: number) => string) => value === null || value === undefined || !Number.isFinite(Number(value)) ? "Not reported" : format(Number(value))
  return (
    <div className="space-y-5" data-testid="landing-owner-page">
      <PageIntro
        eyebrow="Owner Landing"
        title="Manufacturing overview"
        description="Review customer commitments, production holds and the next dispatch handoff. Open a metric to act on its source records."
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
                ? `${delayedOrders.length} customer commitments need review.`
                : "No delayed commitments reported in this summary."}
            </p>
            <p className="text-sm leading-6 text-slate-300">
              Open order book {formatCompactCurrency(orderBookValue)}. Dispatch posture {formatCompactNumber(Number(headline.dispatch_qty || 0))} kg in the selected window.
            </p>
          </div>
        }
      />

      <InsightStrip items={insights.map(item => ({ ...item, onClick: () => router.push(item.id === "delayed" ? "/sales-orders/pending" : item.id === "blocked" ? "/planning/tracker" : "/analytics/mrp") }))} />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <KpiCard label="Dispatched value" value={metric(salesAggregates?.dispatched_value ?? headline.dispatch_value, formatCompactCurrency)} detail="Fulfilled quantity × sales-line rate" icon={BarChart3} onClick={() => router.push("/reports/dispatch")} hrefLabel="View dispatch report" />
        <KpiCard label="Open order book" value={metric(salesAggregates?.open_order_book_value, formatCompactCurrency)} detail={`${openOrderCount} orders with quantity remaining`} icon={Workflow} onClick={() => router.push("/sales-orders/pending")} hrefLabel="Review commitments" />
        <KpiCard label="Inventory value" value={metric(headline.inventory_value ?? inventoryHealth?.summary?.total_value, formatCompactCurrency)} detail="Stock value in the selected plant scope" icon={Factory} onClick={() => router.push("/inventory")} hrefLabel="Open stock overview" />
        <KpiCard label="On time, in full" value={metric(headline.otif_percent, formatPercent)} detail="Closed orders delivered on time and in full" icon={Gauge} sparkline={recentSeries.length ? buildSparkline(recentSeries.map(row => row.otif)) : undefined} onClick={() => router.push("/reports/dispatch")} />
        <KpiCard label="Blocked jobs" value={metric(headline.blocked_jobs ?? (pack.production?.blocked_rows ? blockedRows.length : undefined), formatCompactNumber)} detail="Review the source hold before releasing work" icon={AlertTriangle} onClick={() => router.push("/planning/tracker")} hrefLabel="Review blocked work" />
        <KpiCard label="Material variance" value={metric(pack.reconciliation?.summary?.variance_value, formatCompactCurrency)} detail="Actual consumption variance from reconciliation" icon={Layers3} onClick={() => router.push("/production/reconciliation")} hrefLabel="Open reconciliation" />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <ChartCard eyebrow="Commercial Flow" title="Booked to dispatched value" description="Server-scoped sums across all in-scope sales lines, not the loaded order page.">
          <AreaTrend rows={waterfall} dataKey="value" color="#0891b2" />
        </ChartCard>
        <ChartCard eyebrow="Top Customers" title="Customer share of the current order book" description="Commercial concentration by open order value.">
          <MiniBarList rows={topCustomers} formatter={(value) => formatCompactCurrency(value)} />
          <div className="mt-4">
            <Link href="/sales-orders/pending" className="inline-flex items-center gap-2 text-sm font-semibold text-signal-cyan-ink">
              Open pending workspace <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </ChartCard>
      </section>

      <section className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <ChartCard eyebrow="Operations" title="Live stage load" description="Planner board load grouped by stage from the current board snapshot.">
          {planningLoading ? <p className="text-sm text-muted-foreground">Loading stage queues…</p> : planningError ? <p role="status" className="text-sm text-muted-foreground">Stage queues are unavailable. Open the planner to retry.</p> : <MiniBarList rows={stageRows} formatter={(value) => `${formatCompactNumber(value)} JCs`} />}
        </ChartCard>
        <ChartCard eyebrow="OTIF Trend" title="Daily execution confidence" description="Reported OTIF over recent production and dispatch periods. No unconfigured target is assumed.">
          {recentSeries.length ? <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={recentSeries}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip formatter={(value: number) => [formatPercent(value), "OTIF"]} contentStyle={{ borderRadius: 14, border: "1px solid #e2e8f0" }} />
                <Line type="monotone" dataKey="otif" stroke="#be123c" strokeWidth={2.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div> : <p className="rounded-2xl bg-muted p-5 text-sm text-muted-foreground">No production or dispatch events exist in the selected period.</p>}
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
        <ChartCard eyebrow="Dispatch & Plant Mix" title="Inventory by plant & next handoff" description="Reported inventory values by plant, followed by the dispatch queue.">
          {plantMix.length ? <MiniBarList rows={plantMix} formatter={(value) => formatCompactCurrency(value)} /> : <p className="rounded-2xl bg-muted p-4 text-sm text-muted-foreground">No plant-comparison records exist in the selected period.</p>}
          <div className="mt-5 rounded-[1.35rem] border border-border bg-muted p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Dispatch handoff</p>
            <p className="mt-2 text-2xl font-semibold text-foreground">{metric(pack.dispatch?.summary?.ready_job_count, formatCompactNumber)} ready jobs</p>
            <p className="mt-1 text-sm text-muted-foreground">Use the dispatch desk for sequence and challan generation.</p>
            <Link href="/logistics/dispatch" className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-signal-cyan-ink">
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
          {infrastructureRows.length ? <MiniBarList rows={infrastructureRows} formatter={(value) => formatCompactNumber(value)} /> : <p className="text-sm text-muted-foreground">Runtime metrics are unavailable.</p>}
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
          {schedulerJobs.length ? <MiniBarList rows={schedulerJobs} formatter={(value) => `${formatCompactNumber(value)}%`} /> : <p className="text-sm text-muted-foreground">No scheduler job status was returned.</p>}
        </ChartCard>
        <ChartCard eyebrow="Accounts" title="Access visibility" description="Account data is measured separately from sessions.">
          <p className="text-3xl font-semibold text-foreground">{summary.active_accounts == null ? "Unknown" : formatCompactNumber(Number(summary.active_accounts))}</p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">Enabled accounts reported by auth-service. The stack does not fabricate a current session count.</p>
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
              <Link key={item.href} href={item.href} className="flex items-center justify-between rounded-[1.2rem] border border-border px-4 py-3 text-sm font-semibold text-muted-foreground hover:bg-muted">
                <span className="inline-flex items-center gap-2">
                  <item.icon className="h-4 w-4 text-signal-cyan-ink" />
                  {item.label}
                </span>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </Link>
            ))}
          </div>
        </ChartCard>
      </section>
    </div>
  )
}
