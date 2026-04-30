"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { ArrowRight } from "lucide-react"
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

import { ChartCard, CompactTable, FilterChip, InsightStrip, KpiCard, MiniBarList, PageIntro, formatCompactCurrency, formatCompactNumber, formatPercent } from "@/components/erp/premium-dashboard"
import { useAuth } from "@/context/AuthContext"
import { useOwnerPack } from "@/hooks/use-analytics"
import { displayPlantScope } from "@/lib/plant-scope"

function toSeries(raw: any[]) {
  return (Array.isArray(raw) ? raw : []).map((row: any, index: number) => ({
    label: row.bucket || row.date || row.label || `P${index + 1}`,
    winder: Number(row.winder_qty || 0),
    oven: Number(row.oven_qty || 0),
    process: Number(row.process_qty || 0),
    dispatch: Number(row.dispatch_qty || 0),
    otif: Number(row.otif_percent || row.otif || 0),
    backlog: Number(row.backlog_orders || row.backlog || 0),
    blocked: Number(row.blocked_jobs || row.blocked || 0),
  }))
}

export default function DashboardOverviewPage() {
  const { activePlant } = useAuth()
  const [preset, setPreset] = useState<"30" | "90">("30")
  const { data, isLoading, isError } = useOwnerPack(activePlant ? { plant: activePlant } : undefined, { enabled: true })
  const pack: any = data || {}
  const headline = pack.headline || {}
  const production = pack.production || {}
  const sales = pack.sales || {}
  const inventory = pack.inventory || {}
  const series = useMemo(() => toSeries(production.series || []).slice(preset === "30" ? -10 : -18), [preset, production.series])
  const delayedRows = Array.isArray(sales.delayed_rows) ? sales.delayed_rows : []
  const blockedRows = Array.isArray(production.blocked_rows) ? production.blocked_rows : []
  const lowStockRows = Array.isArray(inventory?.risk_items?.low_stock) ? inventory.risk_items.low_stock : []
  const stageRows = Array.isArray(production.stage_pipeline)
    ? production.stage_pipeline.map((row: any) => ({ label: row.stage || row.stage_type || "Stage", value: Number(row.count || row.value || 0) }))
    : []
  const topCustomers = (Array.isArray(sales.top_customers) ? sales.top_customers : []).map((row: any) => ({
    label: row.customer_name || row.name || "Customer",
    value: Number(row.revenue || row.value || 0),
  }))
  const backlogSparkline = series.some((row) => row.backlog > 0) ? series.map((row) => ({ label: row.label, value: row.backlog })) : undefined
  const blockedSparkline = series.some((row) => row.blocked > 0) ? series.map((row) => ({ label: row.label, value: row.blocked })) : undefined

  return (
    <div className="space-y-5" data-testid="analytics-dashboard-page">
      <PageIntro
        eyebrow="Intelligence & Analytics"
        title="Comparative production, sales, inventory, and anomaly-led operating intelligence."
        description="This surface is the answer layer behind the owner landing: deltas, trend posture, stage pressure, commercial drift, and the exceptions worth drilling into."
        actions={
          <>
            <FilterChip active={preset === "30"} onClick={() => setPreset("30")}>Last 30d</FilterChip>
            <FilterChip active={preset === "90"} onClick={() => setPreset("90")}>Last 90d</FilterChip>
            <FilterChip>{displayPlantScope(activePlant, "ALL PLANTS")}</FilterChip>
          </>
        }
      />

      <InsightStrip
        items={[
          isLoading ? { id: "loading", tone: "warn", title: "Loading live analytics feed...", action: "Wait" } : null,
          isError ? { id: "error", tone: "critical", title: "Analytics feed failed. Check backend services before presenting.", action: "Retry" } : null,
          blockedRows.length ? { id: "blocked", tone: "critical", title: `Blocked jobs are elevated at ${blockedRows.length}; production drift needs review.`, action: "Tracker" } : null,
          delayedRows.length ? { id: "otif", tone: "warn", title: `${delayedRows.length} delayed sales orders are pressuring OTIF.`, action: "Sales" } : null,
          lowStockRows.length ? { id: "stock", tone: "warn", title: `${lowStockRows.length} low-stock materials could affect release capacity.`, action: "MRP" } : { id: "util", tone: "good", title: "Material risk feed is currently stable.", action: "MRP" },
        ].filter(Boolean) as any}
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Active Jobs" value={formatCompactNumber(Number(headline.active_job_cards || 0))} detail="Execution load on the route" tone="cyan" sparkline={series.map((row) => ({ label: row.label, value: row.winder + row.oven + row.process }))} />
        <KpiCard label="Sales Backlog" value={formatCompactNumber(Number(headline.backlog_orders || sales.summary?.backlog_orders || 0))} detail="Open commercial demand" tone="amber" sparkline={backlogSparkline} />
        <KpiCard label="Blocked Jobs" value={formatCompactNumber(Number(headline.blocked_jobs || blockedRows.length || 0))} detail="Needs planner or supervisor action" tone={Number(headline.blocked_jobs || blockedRows.length || 0) ? "rose" : "emerald"} sparkline={blockedSparkline} />
        <KpiCard label="OTIF" value={formatPercent(Number(headline.otif_percent || sales.summary?.otif_percent || 0))} detail="Closed orders on-time and in-full" tone={Number(headline.otif_percent || 0) >= 92 ? "emerald" : "rose"} sparkline={series.map((row) => ({ label: row.label, value: row.otif }))} />
        <KpiCard label="Inventory Value" value={formatCompactCurrency(Number(headline.inventory_value || inventory.summary?.inventory_value || 0))} detail="RM, WIP, and FG valuation" tone="violet" />
        <KpiCard label="Low Stock" value={formatCompactNumber(Number(headline.low_stock_items || lowStockRows.length || 0))} detail="Reorder and safety pressure" tone={Number(headline.low_stock_items || lowStockRows.length || 0) ? "amber" : "emerald"} />
        <KpiCard label="Dispatch Qty" value={`${formatCompactNumber(Number(headline.dispatch_qty || 0))} kg`} detail="Dispatched in the selected window" tone="emerald" sparkline={series.map((row) => ({ label: row.label, value: row.dispatch }))} />
        <KpiCard label="Variance Proxy" value={formatCompactCurrency(Number(pack.reconciliation?.summary?.variance_value || 0))} detail="Current reconciliation visibility" tone="slate" />
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <ChartCard eyebrow="Production" title="Stage throughput trend" description="Multi-stage trend across the selected comparison window.">
          <div className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ borderRadius: 14, border: "1px solid #e2e8f0" }} />
                <Line type="monotone" dataKey="winder" stroke="#0891b2" strokeWidth={2.2} dot={false} />
                <Line type="monotone" dataKey="oven" stroke="#d97706" strokeWidth={2.2} dot={false} />
                <Line type="monotone" dataKey="process" stroke="#4f46e5" strokeWidth={2.2} dot={false} />
                <Line type="monotone" dataKey="dispatch" stroke="#16a34a" strokeWidth={2.2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
        <ChartCard eyebrow="OTIF" title="Daily OTIF vs target" description="Trend posture with a clear below-target read.">
          <div className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip formatter={(value: number) => [formatPercent(value), "OTIF"]} contentStyle={{ borderRadius: 14, border: "1px solid #e2e8f0" }} />
                <Line type="monotone" dataKey="otif" stroke="#be123c" strokeWidth={2.4} dot={false} />
                <Line type="monotone" dataKey={() => 92} stroke="#0f172a" strokeDasharray="6 6" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      </section>

      <section className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <ChartCard eyebrow="Live WIP" title="WIP by stage" description="Current stage queue volume from the owner pack.">
          <MiniBarList rows={stageRows} formatter={(value) => `${formatCompactNumber(value)} JCs`} />
        </ChartCard>
        <ChartCard eyebrow="Commercial" title="Top customers" description="Current commercial concentration from the analytics feed.">
          {topCustomers.length ? (
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topCustomers}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <Tooltip formatter={(value: number) => [formatCompactCurrency(value), "Value"]} contentStyle={{ borderRadius: 14, border: "1px solid #e2e8f0" }} />
                  <Bar dataKey="value" fill="#0891b2" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="rounded-[1.3rem] border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
              Top-customer analytics feed is not currently available.
            </div>
          )}
        </ChartCard>
      </section>

      <ChartCard eyebrow="Drill Rows" title="Operational exceptions" description="Detail rows behind the current insight stack.">
        <CompactTable
          columns={[
            { key: "ref", label: "Reference" },
            { key: "type", label: "Type" },
            { key: "detail", label: "Detail" },
          ]}
          rows={[
            ...delayedRows.slice(0, 5).map((row: any) => ({ ref: row.order_no || row.id || "-", type: "Sales", detail: `${row.customer_name || "Customer"} due ${row.due_date || "-"}` })),
            ...blockedRows.slice(0, 5).map((row: any) => ({ ref: row.job_card_no || row.job_card_id || "-", type: "Production", detail: `${row.current_stage || "Stage"} · ${row.customer_name || "Customer"}` })),
            ...lowStockRows.slice(0, 5).map((row: any) => ({ ref: row.item_code || row.id || "-", type: "Inventory", detail: `${formatCompactNumber(Number(row.available_qty || 0))} available` })),
          ]}
          emptyLabel="No drill rows are available for the current window."
        />
        <div className="mt-4">
          <Link href="/reports" className="inline-flex items-center gap-2 text-sm font-semibold text-cyan-900">
            Open reports suite <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </ChartCard>
    </div>
  )
}
