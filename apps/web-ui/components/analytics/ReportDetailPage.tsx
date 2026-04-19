"use client"

import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

import { useAuth } from "@/context/AuthContext"
import { analyticsApi } from "@/lib/api"

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
    title: "Plant Comparison",
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

function SummaryGrid({ summary }: { summary: any }) {
  const entries = Object.entries(summary || {}).slice(0, 8)
  if (!entries.length) return <p className="text-sm text-slate-500">No summary metrics returned for this report.</p>
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {entries.map(([key, value]) => (
        <div key={key} className="rounded-[1.35rem] border border-slate-200 bg-white px-4 py-4 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">{formatLabel(key)}</p>
          <p className="mt-3 text-2xl font-black text-slate-950">{formatValue(value)}</p>
        </div>
      ))}
    </div>
  )
}

function DataTable({ rows }: { rows: any[] }) {
  const columns = useMemo(() => {
    const keys = new Set<string>()
    for (const row of rows.slice(0, 10)) {
      Object.keys(row || {}).forEach((key) => {
        if (!key.endsWith("_id") || key === "job_card_id" || key === "order_id" || key === "plant_id") keys.add(key)
      })
    }
    return Array.from(keys).slice(0, 6)
  }, [rows])

  return (
    <div className="overflow-x-auto rounded-[1.4rem] border border-slate-200 bg-white">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-slate-950 text-white">
          <tr>
            {columns.map((column) => (
              <th key={column} className="px-4 py-3 text-[10px] font-black uppercase tracking-[0.18em]">{formatLabel(column)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 18).map((row, index) => (
            <tr key={row.id || row.job_card_id || row.order_id || index} className="border-t border-slate-200">
              {columns.map((column) => (
                <td key={column} className="max-w-[240px] truncate px-4 py-3 font-medium text-slate-700">{formatValue(row[column])}</td>
              ))}
            </tr>
          ))}
          {!rows.length ? <tr><td colSpan={Math.max(1, columns.length)} className="px-4 py-8 text-center text-slate-500">No rows for the selected window.</td></tr> : null}
        </tbody>
      </table>
    </div>
  )
}

export function ReportDetailPage({ type }: { type: ReportType }) {
  const { activePlant } = useAuth()
  const [startDate, setStartDate] = useState(daysAgo(29))
  const [endDate, setEndDate] = useState(today())
  const meta = REPORT_META[type]
  const params = { start_date: startDate, end_date: endDate, granularity: "day", plant: activePlant }
  const query = useQuery({
    queryKey: ["report-detail", type, activePlant, startDate, endDate],
    queryFn: () => fetchReport(type, params),
  })
  const data = query.data || {}
  const rows = primaryRows(type, data)
  const chart = chartRows(data).slice(-14)
  const chartKeys = Object.keys(chart[0] || {}).filter((key) => key !== "bucket").slice(0, 4)

  return (
    <main className="space-y-5 px-6 pb-8 pt-2" data-testid={`report-detail-${type}`}>
      <section className="rounded-[2rem] border border-slate-200 bg-white px-6 py-5 shadow-[0_18px_60px_rgba(15,23,42,0.06)]">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.26em] text-slate-400">{meta.eyebrow}</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">{meta.title}</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{meta.description}</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="h-11 rounded-2xl border border-slate-200 bg-white px-3 text-sm font-semibold" />
            <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="h-11 rounded-2xl border border-slate-200 bg-white px-3 text-sm font-semibold" />
          </div>
        </div>
      </section>

      {query.isLoading ? (
        <div className="rounded-[2rem] border border-slate-200 bg-white p-8 text-slate-500">Loading report...</div>
      ) : query.isError ? (
        <div className="rounded-[2rem] border border-rose-200 bg-rose-50 p-8 text-rose-700">Report service failed for this page.</div>
      ) : (
        <>
          <SummaryGrid summary={data.summary} />
          <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-[0_18px_60px_rgba(15,23,42,0.06)]">
              <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">Trend</p>
              <div className="mt-4 h-[320px]">
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
            </div>
            <div className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-[0_18px_60px_rgba(15,23,42,0.06)]">
              <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">Decision Notes</p>
              <div className="mt-4 space-y-3 text-sm leading-6 text-slate-600">
                <p>Use this page to identify the action queue, then open the source workflow for correction. Report rows retain job/order/plant references where the backend provides them.</p>
                <p>For reconciliation: known rejection qty and reason should be captured at stage entry; only the unexplained balance should remain in monthly variance.</p>
                <p>Current data scope: <span className="font-black text-slate-950">{activePlant || "No plant selected"}</span>.</p>
              </div>
            </div>
          </section>
          <DataTable rows={rows} />
        </>
      )}
    </main>
  )
}
