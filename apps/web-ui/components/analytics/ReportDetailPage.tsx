"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

import { ChartCard, CompactTable, FilterChip, KpiCard, PageIntro, formatCompactCurrency, formatCompactNumber, formatPercent } from "@/components/erp/premium-dashboard"
import { useAuth } from "@/context/AuthContext"
import { analyticsApi } from "@/lib/api"
import { displayPlantScope } from "@/lib/plant-scope"

type ReportType = "production" | "sales" | "inventory" | "quality" | "dispatch" | "plants" | "exceptions"

const today = () => new Date().toISOString().slice(0, 10)
const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
const numberValue = (value: unknown) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}
const formatLabel = (value: string) => value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())
const formatValue = (value: unknown) => {
  if (typeof value === "string") return value
  const number = Number(value)
  if (Number.isFinite(number)) return number.toLocaleString("en-IN", { maximumFractionDigits: 2 })
  if (value === null || value === undefined || value === "") return "-"
  return String(value)
}

const REPORT_META: Record<ReportType, { title: string; eyebrow: string; description: string }> = {
  production: {
    title: "Production Performance",
    eyebrow: "Floor execution",
    description: "Throughput by stage, active cards, blocked jobs, machine load, and planner adherence.",
  },
  sales: {
    title: "Sales and Release Health",
    eyebrow: "Commercial demand",
    description: "Backlog, closed orders, delayed demand, OTIF, and release-to-dispatch history.",
  },
  inventory: {
    title: "Inventory Health",
    eyebrow: "Stock and risk",
    description: "RM/WIP/FG value, low-stock risk, blocked quantity, location occupancy, and genealogy exceptions.",
  },
  quality: {
    title: "Quality and Rejections",
    eyebrow: "QC intelligence",
    description: "Inspection pass/fail posture, active holds, stage failure mix, and rejection trail.",
  },
  dispatch: {
    title: "Dispatch Readiness",
    eyebrow: "FG to gate",
    description: "Ready jobs, sealed dispatches, dispatched quantity, and closed-order movement.",
  },
  plants: {
    title: "Cross-plant Comparison",
    eyebrow: "Owner view",
    description: "Plant-wise cards, inventory value, blocked quantity, ready jobs, and delayed order load.",
  },
  exceptions: {
    title: "Exceptions Command Center",
    eyebrow: "Action queue",
    description: "Delayed orders, blocked jobs, stock risks, overstock, and active quality holds.",
  },
}

async function fetchReport(type: ReportType, params: any) {
  if (type === "production") return (await analyticsApi.getProductionReport(params)).data
  if (type === "sales") return (await analyticsApi.getSalesReport(params)).data
  if (type === "inventory") return (await analyticsApi.getInventoryHealthReport(params)).data
  if (type === "quality") return (await analyticsApi.getQualityReport(params)).data
  if (type === "dispatch") return (await analyticsApi.getDispatchReport(params)).data
  if (type === "plants") return (await analyticsApi.getPlantCompareReport(params)).data
  return (await analyticsApi.getExceptionReport(params)).data
}

function primaryRows(type: ReportType, data: any) {
  if (type === "production") return data?.blocked_rows || data?.machine_utilization || []
  if (type === "sales") return data?.delayed_rows || []
  if (type === "inventory") return data?.risk_items?.low_stock || data?.locations || []
  if (type === "quality") return data?.hold_rows || data?.fail_by_stage || []
  if (type === "dispatch") return data?.ready_jobs || []
  if (type === "plants") return data?.rows || []
  return data?.delayed_orders || data?.blocked_jobs || data?.low_stock || []
}

function chartRows(data: any) {
  const source = Array.isArray(data?.series) ? data.series : []
  return source.map((row: any) => {
    const result: Record<string, any> = { bucket: row.bucket || row.date || row.label || "-" }
    for (const [key, value] of Object.entries(row)) {
      if (key === "bucket" || key === "date" || key === "label") continue
      if (Number.isFinite(Number(value))) result[formatLabel(key)] = Number(value)
    }
    return result
  })
}

function summaryTone(key: string, value: unknown) {
  const numeric = Number(value || 0)
  const normalized = key.toLowerCase()
  if (normalized.includes("otif") || normalized.includes("yield") || normalized.includes("on_time")) {
    return numeric >= 92 ? "emerald" : "rose"
  }
  if (normalized.includes("blocked") || normalized.includes("delay") || normalized.includes("hold")) {
    return numeric > 0 ? "rose" : "emerald"
  }
  if (normalized.includes("low_stock") || normalized.includes("overstock")) {
    return numeric > 0 ? "amber" : "emerald"
  }
  return "cyan"
}

export function ReportDetailPage({ type }: { type: ReportType }) {
  const { activePlant } = useAuth()
  const [startDate, setStartDate] = useState(daysAgo(29))
  const [endDate, setEndDate] = useState(today())
  const meta = REPORT_META[type]
  const activePlantLabel = displayPlantScope(activePlant, "No plant selected")
  const params = { start_date: startDate, end_date: endDate, granularity: "day", plant: activePlant }
  const query = useQuery({
    queryKey: ["report-detail", type, activePlant, startDate, endDate],
    queryFn: () => fetchReport(type, params),
  })
  const data = query.data || {}
  const rows = primaryRows(type, data)
  const chart = chartRows(data).slice(-14)
  const chartKeys = Object.keys(chart[0] || {}).filter((key) => key !== "bucket").slice(0, 4)
  const summaryEntries = Object.entries(data.summary || {}).slice(0, 6)
  const tableColumns = useMemo(() => {
    const keys = new Set<string>()
    for (const row of rows.slice(0, 10)) {
      Object.keys(row || {}).forEach((key) => {
        if (!key.endsWith("_id") || key === "job_card_id" || key === "order_id" || key === "plant_id") keys.add(key)
      })
    }
    return Array.from(keys).slice(0, 6).map((key) => ({
      key,
      label: formatLabel(key),
      render: (row: any) => (key === "plant_id" || key === "plant" ? displayPlantScope(row[key], "-") : formatValue(row[key])),
    }))
  }, [rows])

  return (
    <div className="space-y-5 px-6 pb-8 pt-2" data-testid={`report-detail-${type}`}>
      <PageIntro
        eyebrow={meta.eyebrow}
        title={meta.title}
        description={meta.description}
        actions={
          <>
            <FilterChip active>{activePlantLabel}</FilterChip>
            <FilterChip>{startDate}</FilterChip>
            <FilterChip>{endDate}</FilterChip>
          </>
        }
        aside={
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-300">
              From
              <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="mt-2 h-10 w-full rounded-2xl border border-white/10 bg-white/10 px-3 text-sm text-white outline-none" />
            </label>
            <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-300">
              To
              <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="mt-2 h-10 w-full rounded-2xl border border-white/10 bg-white/10 px-3 text-sm text-white outline-none" />
            </label>
          </div>
        }
      />

      {query.isLoading ? (
        <div className="rounded-[2rem] border border-slate-200 bg-white p-8 text-slate-500">Loading report...</div>
      ) : query.isError ? (
        <div className="rounded-[2rem] border border-rose-200 bg-rose-50 p-8 text-rose-700">Report service failed for this page.</div>
      ) : (
        <>
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {summaryEntries.map(([key, value]) => (
              <KpiCard
                key={key}
                label={formatLabel(key)}
                value={
                  key.toLowerCase().includes("value") || key.toLowerCase().includes("cost")
                    ? formatCompactCurrency(Number(value || 0))
                    : key.toLowerCase().includes("otif") || key.toLowerCase().includes("yield")
                      ? formatPercent(Number(value || 0))
                      : formatCompactNumber(Number(value || 0), Number(value || 0) % 1 !== 0 ? 1 : 0)
                }
                detail="Live summary metric"
                tone={summaryTone(key, value) as any}
              />
            ))}
          </section>

          <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
            <ChartCard eyebrow="Primary Visual" title="Trend" description="Primary period trend from the report service.">
              <div className="h-[320px]">
                {chart.length && chartKeys.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chart}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                      <XAxis dataKey="bucket" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                      <Tooltip contentStyle={{ borderRadius: 14, border: "1px solid #e2e8f0" }} />
                      {chartKeys.map((key, index) => (
                        <Bar key={key} dataKey={key} fill={["#0891b2", "#f59e0b", "#0f766e", "#334155"][index % 4]} radius={[6, 6, 0, 0]} />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center rounded-2xl bg-slate-50 text-sm text-slate-500">No trend series returned.</div>
                )}
              </div>
            </ChartCard>

            <ChartCard eyebrow="Decision Notes" title="How to use this report" description="Operator-facing notes for the current report mode.">
              <div className="space-y-3 text-sm leading-6 text-slate-600">
                <p>Use this page to identify the action queue, then open the source workflow for correction. Report rows retain job, order, and plant references where the backend provides them.</p>
                <p>For reconciliation: known rejection qty and reason should be captured at stage entry; only the unexplained balance should remain in monthly variance.</p>
                <p>Current data scope: <span className="font-bold text-slate-950">{activePlantLabel}</span>.</p>
                <Link href="/reports" className="inline-flex items-center gap-2 font-semibold text-cyan-900">
                  Back to reports hub
                </Link>
              </div>
            </ChartCard>
          </section>

          <ChartCard eyebrow="Detail Table" title="Underlying rows" description="Table view of the current report slice for export or follow-up.">
            <CompactTable
              columns={tableColumns}
              rows={rows.slice(0, 18)}
              emptyLabel="No rows for the selected window."
            />
          </ChartCard>
        </>
      )}
    </div>
  )
}
