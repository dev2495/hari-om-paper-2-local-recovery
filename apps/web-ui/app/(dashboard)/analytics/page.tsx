"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

import { RoleGate } from "@/components/workspace/role-gate"
import {
  DrillLink,
  FilterField,
  KpiRail,
  MiniLadder,
  NoteCallout,
  Panel,
  Pill,
  ReportFilterBar,
  ReportHero,
  formatCurrency,
  formatNumber,
  formatPct,
} from "@/components/reports/primitives"
import { useAuth } from "@/context/AuthContext"
import { useExceptionReport, useOwnerPack, useSalesReport } from "@/hooks/use-analytics"
import { usePlantScopeLabel } from "@/hooks/use-plant-scope-label"

export default function AnalyticsLandingWrapper() {
  return (
    <RoleGate allow={["PlantManager", "Planner", "Store", "Dispatch", "Sales", "Owner", "Admin"]}>
      <AnalyticsLandingPage />
    </RoleGate>
  )
}

function AnalyticsLandingPage() {
  const { activePlant } = useAuth()
  const activePlantLabel = usePlantScopeLabel(activePlant)
  const [period, setPeriod] = useState<"7" | "30" | "90">("30")
  const today = new Date().toISOString().split("T")[0]
  const startDate = new Date(Date.now() - Number(period) * 24 * 60 * 60 * 1000).toISOString().split("T")[0]

  const { data: ownerPack, isLoading } = useOwnerPack(activePlant ? { plant: activePlant } : undefined, { enabled: true })
  const { data: salesReport } = useSalesReport({ startDate, endDate: today, plant: activePlant || undefined, granularity: "day" })
  const { data: exceptionReport } = useExceptionReport({ startDate, endDate: today, plant: activePlant || undefined, granularity: "day" })

  const pack: any = ownerPack || {}
  const headline = pack.headline || {}
  const production = pack.production || {}
  const sales = pack.sales || {}
  const inventory = pack.inventory || {}
  const reconciliation = pack.reconciliation || {}

  const series = useMemo(() => {
    const raw = (production?.series || []) as any[]
    return raw.map((row: any, i: number) => ({
      label: row.bucket || row.date || row.label || `D${i + 1}`,
      winder: Number(row.winder_qty || 0),
      oven: Number(row.oven_qty || 0),
      process: Number(row.process_qty || 0),
      dispatch: Number(row.dispatch_qty || 0),
      otif: Number(row.otif_percent || row.otif || 0),
    }))
  }, [production?.series])

  // Anomaly: detect blocked-job spike
  const blockedRows = Array.isArray(production.blocked_rows) ? production.blocked_rows : []
  const delayedRows = Array.isArray(sales.delayed_rows) ? sales.delayed_rows : []
  const lowStockRows = Array.isArray(inventory?.risk_items?.low_stock) ? inventory.risk_items.low_stock : []
  const topCustomers = (Array.isArray(sales.top_customers) ? sales.top_customers : []).slice(0, 6)

  const stagePipeline = Array.isArray(production.stage_pipeline)
    ? production.stage_pipeline.map((row: any) => ({
        label: row.stage || row.stage_type || "Stage",
        value: Number(row.count || row.value || 0),
        tone: row.tone || (Number(row.count || 0) > 10 ? "warn" : "ok"),
      }))
    : []

  const otifValue = Number(headline.otif_percent || sales.summary?.otif_percent || 0)
  const inventoryValue = Number(headline.inventory_value || inventory.summary?.inventory_value || 0)
  const blockedCount = Number(headline.blocked_jobs || blockedRows.length || 0)
  const lowStockCount = Number(headline.low_stock_items || lowStockRows.length || 0)
  const activeJobs = Number(headline.active_job_cards || 0)
  const dispatchQty = Number(headline.dispatch_qty || 0)
  const dispatchValue = Number(headline.dispatch_value || 0)
  const backlogOrders = Number(headline.backlog_orders || salesReport?.summary?.backlog_orders || 0)
  const varianceValue = Number(reconciliation.summary?.variance_value || 0)
  const exceptionsTotal =
    Number(exceptionReport?.summary?.delayed_orders || 0) +
    Number(exceptionReport?.summary?.blocked_jobs || 0) +
    Number(exceptionReport?.summary?.active_qc_holds || 0)

  // anomalies
  const anomalies: Array<{ id: string; title: string; tone: "warn" | "critical"; href: string }> = []
  if (blockedCount >= 4) {
    anomalies.push({
      id: "blocked",
      title: `Blocked-job count elevated: ${blockedCount} blockers in the current report payload.`,
      tone: "critical",
      href: "/reports/operations",
    })
  }
  if (delayedRows.length >= 3) {
    anomalies.push({
      id: "delays",
      title: `${delayedRows.length} sales orders are past promise date — pressuring OTIF.`,
      tone: "warn",
      href: "/reports/sales",
    })
  }
  if (otifValue > 0 && otifValue < 92) {
    anomalies.push({
      id: "otif",
      title: `OTIF at ${formatPct(otifValue)} is below the 92% target band.`,
      tone: "warn",
      href: "/reports/sales",
    })
  }
  if (lowStockCount >= 10) {
    anomalies.push({
      id: "stock",
      title: `${lowStockCount} items below reorder. ${activePlantLabel} should refresh MRP.`,
      tone: "warn",
      href: "/analytics/mrp",
    })
  }

  return (
    <div className="space-y-5 px-6 pb-10 pt-2" data-testid="analytics-landing-page">
      <ReportHero
        eyebrow="Analytics & KPIs"
        title="Live snapshot · 12 KPIs · trend posture · anomaly insights."
        description="The answer layer behind the reports surface. Click any KPI tile to drill into the underlying detail rows, or jump to a finished report from /reports."
        accent="violet"
        chips={[
          { label: `${anomalies.length} anomalies`, tone: anomalies.length ? "warn" : "ok" },
          { label: `OTIF ${formatPct(otifValue)}`, tone: otifValue >= 92 ? "ok" : "warn" },
          { label: `${formatNumber(activeJobs)} active jobs`, tone: "neutral" },
          { label: isLoading ? "loading…" : `last refresh just now`, tone: "neutral" },
        ]}
      />

      <ReportFilterBar>
        <FilterField label="Period">
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as any)}
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm font-medium text-slate-900"
          >
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
          </select>
        </FilterField>
        <FilterField label="Plant">
          <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-sm font-semibold text-slate-700">
            {activePlantLabel}
          </span>
        </FilterField>
        <span className="ml-auto" />
        <Link href="/reports" className="text-sm font-semibold text-cyan-800 hover:underline">
          Open reports landing →
        </Link>
      </ReportFilterBar>

      {/* Anomaly band */}
      {anomalies.length ? (
        <div className="space-y-2">
          {anomalies.map((a) => (
            <Link key={a.id} href={a.href} className="block">
              <div
                className={
                  "flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 shadow-sm hover:shadow transition " +
                  (a.tone === "critical" ? "border-rose-300 bg-rose-50" : "border-amber-300 bg-amber-50")
                }
              >
                <div className="flex items-center gap-2 text-sm">
                  <Pill tone={a.tone === "critical" ? "critical" : "warn"}>{a.tone === "critical" ? "Critical" : "Watch"}</Pill>
                  <span className="font-medium text-slate-900">{a.title}</span>
                </div>
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Open →</span>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <NoteCallout tone="ok">No anomalies firing right now. Operations look stable for the selected window.</NoteCallout>
      )}

      {/* Hero KPIs */}
      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Hero KPIs</p>
      <KpiRail
        items={[
          {
            label: "Active jobs",
            value: formatNumber(activeJobs),
            tone: "cyan",
            detail: "Execution load on the route",
            delta: { value: `${formatNumber(Math.abs(activeJobs - (production.summary?.avg_active || activeJobs)))}`, direction: "up", label: "vs avg" },
            href: "/reports/operations",
          },
          {
            label: "Sales backlog",
            value: formatNumber(backlogOrders),
            tone: "amber",
            detail: "Open commercial demand",
            href: "/reports/sales",
          },
          {
            label: "OTIF",
            value: formatPct(otifValue),
            tone: otifValue >= 92 ? "emerald" : "rose",
            detail: "On-time, in-full closed orders",
            delta: { value: `${formatPct(Math.abs(otifValue - 92), 1)}`, direction: otifValue >= 92 ? "up" : "down", label: "vs target" },
            href: "/reports/sales",
          },
          {
            label: "Blocked jobs",
            value: formatNumber(blockedCount),
            tone: blockedCount ? "rose" : "emerald",
            detail: "Need planner / supervisor",
            href: "/reports/operations",
          },
          {
            label: "Inventory value",
            value: formatCurrency(inventoryValue),
            tone: "violet",
            detail: "RM + WIP + FG valuation",
            href: "/reports/inventory",
          },
          {
            label: "Variance",
            value: formatCurrency(varianceValue),
            tone: "slate",
            detail: "Reconciliation proxy",
            href: "/production/reconciliation",
          },
        ]}
      />

      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Secondary KPIs</p>
      <KpiRail
        items={[
          {
            label: "Dispatch ₹ (period)",
            value: formatCurrency(dispatchValue),
            tone: "cyan",
            detail: `${formatNumber(dispatchQty)} kg dispatched`,
            href: "/reports/dispatch",
          },
          {
            label: "Low stock items",
            value: formatNumber(lowStockCount),
            tone: lowStockCount ? "amber" : "emerald",
            detail: "Below reorder level",
            href: "/analytics/mrp",
          },
          {
            label: "Delayed orders",
            value: formatNumber(delayedRows.length || Number(salesReport?.summary?.delayed_orders || 0)),
            tone: "rose",
            detail: "Past promise date",
            href: "/reports/sales",
          },
          {
            label: "Total exceptions",
            value: formatNumber(exceptionsTotal),
            tone: exceptionsTotal ? "amber" : "emerald",
            detail: "Combined exception streams",
            href: "/reports/exceptions",
          },
          {
            label: "Customers active",
            value: formatNumber(topCustomers.length || 0),
            tone: "violet",
            detail: "Open commercial accounts",
            href: "/reports/customer-360",
          },
          {
            label: "Scrap exposure",
            value: formatCurrency(Number(reconciliation.summary?.scrap_value || 0)),
            tone: "slate",
            detail: "Scrap cost in window",
            href: "/reports/quality",
          },
        ]}
      />

      {/* Charts */}
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel eyebrow="Throughput trend" title="Stage output (kg)" description="Winder · Oven · Process · Dispatch — converging stages signal upstream pressure.">
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ borderRadius: 14, border: "1px solid #e2e8f0" }} />
                <Line type="monotone" dataKey="winder" stroke="#0e7490" strokeWidth={2.2} dot={false} />
                <Line type="monotone" dataKey="oven" stroke="#b45309" strokeWidth={2.2} dot={false} />
                <Line type="monotone" dataKey="process" stroke="#6d28d9" strokeWidth={2.2} dot={false} />
                <Line type="monotone" dataKey="dispatch" stroke="#047857" strokeWidth={2.2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel eyebrow="OTIF vs target" title="Daily OTIF % with 92% target" description="Red dots = days below target.">
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <ReferenceLine y={92} stroke="#dc2626" strokeDasharray="6 6" />
                <Tooltip formatter={(v: number) => [`${formatPct(v)}`, "OTIF"]} contentStyle={{ borderRadius: 14, border: "1px solid #e2e8f0" }} />
                <Line type="monotone" dataKey="otif" stroke="#047857" strokeWidth={2.6} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel eyebrow="Live WIP" title="Stage pipeline" description="Open jobs by current stage. Click a stage to drill into the queue.">
          {stagePipeline.length ? (
            <MiniLadder rows={stagePipeline} formatter={(v) => `${formatNumber(v)} JCs`} />
          ) : (
            <NoteCallout tone="neutral">Stage pipeline feed is not currently populated.</NoteCallout>
          )}
        </Panel>
        <Panel eyebrow="Commercial concentration" title="Top customers" description={`Top ${topCustomers.length} customers in window.`}>
          {topCustomers.length ? (
            <MiniLadder
              rows={topCustomers.map((c: any) => ({
                label: c.customer_name || c.name || "Customer",
                value: Number(c.revenue || c.value || 0),
              }))}
              formatter={(v) => formatCurrency(v)}
            />
          ) : (
            <NoteCallout tone="neutral">No top-customer data in the current window.</NoteCallout>
          )}
        </Panel>
      </div>

      <Panel eyebrow="Live exception streams" title="What's firing right now" description="Click a row to drill into the underlying records.">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              <th className="py-2 pr-3">Stream</th>
              <th className="py-2 pr-3 text-right">Count</th>
              <th className="py-2 pr-3">Severity</th>
              <th className="py-2 pr-3" />
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-slate-100">
              <td className="py-2 pr-3">Jobs blocked &gt; 4h</td>
              <td className="py-2 pr-3 text-right font-bold">{formatNumber(blockedCount)}</td>
              <td><Pill tone={blockedCount ? "critical" : "ok"}>{blockedCount ? "CRITICAL" : "OK"}</Pill></td>
              <td><DrillLink href="/reports/operations">Open</DrillLink></td>
            </tr>
            <tr className="border-b border-slate-100">
              <td className="py-2 pr-3">Orders past promise date</td>
              <td className="py-2 pr-3 text-right font-bold">{formatNumber(delayedRows.length)}</td>
              <td><Pill tone={delayedRows.length ? "warn" : "ok"}>{delayedRows.length ? "WATCH" : "OK"}</Pill></td>
              <td><DrillLink href="/reports/sales">Open</DrillLink></td>
            </tr>
            <tr className="border-b border-slate-100">
              <td className="py-2 pr-3">Items below reorder</td>
              <td className="py-2 pr-3 text-right font-bold">{formatNumber(lowStockCount)}</td>
              <td><Pill tone={lowStockCount ? "warn" : "ok"}>{lowStockCount ? "WATCH" : "OK"}</Pill></td>
              <td><DrillLink href="/analytics/mrp">Open</DrillLink></td>
            </tr>
            <tr>
              <td className="py-2 pr-3">QC holds active</td>
              <td className="py-2 pr-3 text-right font-bold">{formatNumber(Number(exceptionReport?.summary?.active_qc_holds || 0))}</td>
              <td><Pill tone={Number(exceptionReport?.summary?.active_qc_holds || 0) ? "critical" : "ok"}>{Number(exceptionReport?.summary?.active_qc_holds || 0) ? "CRITICAL" : "OK"}</Pill></td>
              <td><DrillLink href="/reports/quality">Open</DrillLink></td>
            </tr>
          </tbody>
        </table>
      </Panel>
    </div>
  )
}
