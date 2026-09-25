"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Boxes,
  CheckCircle2,
  Clock3,
  Download,
  Factory,
  Gauge,
  PackageCheck,
  Printer,
  Search,
  ShieldAlert,
  Truck,
  type LucideIcon,
} from "lucide-react"

import { ChartEmptyState, ChartTooltip } from "@/components/erp/charts"
import { formatCompactCurrency, formatCompactNumber, formatPercent } from "@/components/erp/premium-dashboard"
import { MetricCard, MetricRail, Panel, type MetricTone } from "@/components/erp/shell"
import { Donut, type DonutSlice } from "@/components/erp/viz"
import { PageHeader } from "@/components/workspace/page-header"
import { useAuth } from "@/context/AuthContext"
import { analyticsApi } from "@/lib/api"
import { displayPlantScope } from "@/lib/plant-scope"
import { cn } from "@/lib/utils"

type ReportType = "production" | "sales" | "inventory" | "quality" | "dispatch" | "plants" | "exceptions"

const isoDay = (offsetDays = 0) => new Date(Date.now() - offsetDays * 86_400_000).toISOString().slice(0, 10)
const formatLabel = (value: string) => value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())
const formatCell = (value: unknown) => {
  if (value === null || value === undefined || value === "") return "—"
  if (typeof value === "number") return value.toLocaleString("en-IN", { maximumFractionDigits: 2 })
  if (typeof value === "boolean") return value ? "Yes" : "No"
  if (typeof value === "object") return "—"
  return String(value).replaceAll("_", " ")
}
const PALETTE = ["hsl(var(--chart-1))", "hsl(var(--chart-2))", "hsl(var(--chart-3))", "hsl(var(--chart-6))", "hsl(var(--chart-7))", "hsl(var(--chart-5))", "hsl(var(--chart-8))", "hsl(var(--chart-4))"]

const REPORT_META: Record<ReportType, { title: string; eyebrow: string; description: string }> = {
  production: { title: "Production performance", eyebrow: "Floor execution", description: "Stage output over time, machine load, planner adherence and the cards that are held at a gate." },
  sales: { title: "Sales and release health", eyebrow: "Commercial demand", description: "Backlog, closed orders, delayed demand, OTIF and release-to-dispatch lead time." },
  inventory: { title: "Inventory health", eyebrow: "Stock and risk", description: "RM / WIP / FG value, low-stock and overstock risk, blocked quantity and QC holds." },
  quality: { title: "Quality and rejections", eyebrow: "QC intelligence", description: "Inspection pass rate, failures by stage and the holds that are stopping material." },
  dispatch: { title: "Dispatch readiness", eyebrow: "FG to gate", description: "Dispatched quantity over time, jobs ready at the gate and sealed dispatches." },
  plants: { title: "Plant comparison", eyebrow: "Owner view", description: "Job cards, inventory value, blocked stock, dispatch-ready work and delays per plant." },
  exceptions: { title: "Exceptions", eyebrow: "Action queue", description: "Everything that needs a person: delayed orders, blocked jobs, stock risk and active QC holds." },
}

/** Each report's row sets, shown as tabs over one table. */
const ROW_SETS: Record<ReportType, Array<{ key: string; label: string; pick: (data: any) => any[] }>> = {
  production: [
    { key: "blocked", label: "Held at a gate", pick: (data) => data?.blocked_rows || [] },
    { key: "machines", label: "Machine load", pick: (data) => data?.machine_utilization || [] },
    { key: "pipeline", label: "Stage pipeline", pick: (data) => data?.stage_pipeline || [] },
  ],
  sales: [{ key: "delayed", label: "Delayed orders", pick: (data) => data?.delayed_rows || [] }],
  inventory: [
    { key: "low", label: "Low stock", pick: (data) => data?.risk_items?.low_stock || [] },
    { key: "over", label: "Overstock", pick: (data) => data?.risk_items?.overstock || [] },
    { key: "locations", label: "Locations", pick: (data) => data?.locations || [] },
  ],
  quality: [
    { key: "holds", label: "Active holds", pick: (data) => data?.hold_rows || [] },
    { key: "fails", label: "Failures by stage", pick: (data) => data?.fail_by_stage || [] },
  ],
  dispatch: [{ key: "ready", label: "Ready at the gate", pick: (data) => data?.ready_jobs || [] }],
  plants: [{ key: "plants", label: "Plants", pick: (data) => data?.rows || [] }],
  exceptions: [
    { key: "delayed", label: "Delayed orders", pick: (data) => data?.delayed_orders || [] },
    { key: "blocked", label: "Blocked jobs", pick: (data) => data?.blocked_jobs || [] },
    { key: "holds", label: "QC holds", pick: (data) => data?.active_holds || [] },
    { key: "low", label: "Low stock", pick: (data) => data?.low_stock || [] },
    { key: "over", label: "Overstock", pick: (data) => data?.overstock || [] },
  ],
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

function metricFor(key: string, value: unknown): { value: string; tone: MetricTone; icon: LucideIcon; progress?: number } {
  const k = key.toLowerCase()
  const n = Number(value ?? 0)
  if (k.includes("percent") || k.includes("otif") || k.includes("rate") || k.includes("yield")) {
    const good = n >= 90
    return { value: value === null || value === undefined ? "—" : formatPercent(n), tone: good ? "emerald" : n >= 70 ? "amber" : "rose", icon: Gauge, progress: Math.min(100, n) }
  }
  if (k.includes("value") || k.includes("cost")) return { value: formatCompactCurrency(n), tone: "blue", icon: Boxes }
  if (k.includes("blocked") || k.includes("delay") || k.includes("hold") || k.includes("failed")) return { value: formatCompactNumber(n), tone: n > 0 ? "rose" : "emerald", icon: n > 0 ? ShieldAlert : CheckCircle2 }
  if (k.includes("low_stock") || k.includes("overstock")) return { value: formatCompactNumber(n), tone: n > 0 ? "amber" : "emerald", icon: AlertTriangle }
  if (k.includes("days")) return { value: `${n.toLocaleString("en-IN", { maximumFractionDigits: 1 })} d`, tone: "violet", icon: Clock3 }
  if (k.includes("dispatch") || k.includes("sealed")) return { value: formatCompactNumber(n, n % 1 ? 1 : 0), tone: "teal", icon: Truck }
  if (k.includes("ready") || k.includes("passed") || k.includes("closed")) return { value: formatCompactNumber(n), tone: "emerald", icon: PackageCheck }
  if (k.includes("job") || k.includes("card")) return { value: formatCompactNumber(n), tone: "cyan", icon: Factory }
  return { value: formatCompactNumber(n, n % 1 ? 1 : 0), tone: "slate", icon: Activity }
}

/** Series from the report service → chart rows with only numeric keys that actually carry data. */
function toChart(data: any) {
  const source: any[] = Array.isArray(data?.series) ? data.series : []
  const rows = source.map((row) => {
    const result: Record<string, any> = { bucket: String(row.bucket || row.date || row.label || "—").slice(5) || "—" }
    for (const [key, value] of Object.entries(row)) {
      if (["bucket", "date", "label"].includes(key)) continue
      if (Number.isFinite(Number(value))) result[formatLabel(key.replace(/_qty$/, ""))] = Number(value)
    }
    return result
  })
  const keys = Array.from(new Set(rows.flatMap((row) => Object.keys(row)))).filter((key) => key !== "bucket" && rows.some((row) => Number(row[key] || 0) !== 0))
  return { rows, keys: keys.slice(0, 5) }
}

function breakdown(type: ReportType, data: any, chart: { rows: any[]; keys: string[] }): { title: string; slices: DonutSlice[]; center: string } {
  if (type === "production") {
    const pipeline: any[] = data?.stage_pipeline || []
    return { title: "Open cards by stage", center: "Open cards", slices: pipeline.map((row, i) => ({ label: formatLabel(String(row.stage_type || "—").toLowerCase()), value: Number(row.count || 0), color: PALETTE[i % PALETTE.length], href: `/production/job-cards?stage=${row.stage_type}` })) }
  }
  if (type === "quality") {
    const fails: any[] = data?.fail_by_stage || []
    const s = data?.summary || {}
    return fails.length
      ? { title: "Failures by stage", center: "Failed", slices: fails.map((row, i) => ({ label: formatLabel(String(row.stage_type || "—").toLowerCase()), value: Number(row.count || 0), color: PALETTE[(i + 4) % PALETTE.length] })) }
      : { title: "Inspection outcome", center: "Checked", slices: [{ label: "Passed", value: Number(s.passed || 0), color: "hsl(var(--chart-7))" }, { label: "Failed", value: Number(s.failed || 0), color: "hsl(var(--chart-5))" }] }
  }
  if (type === "inventory") {
    const s = data?.summary || {}
    return { title: "Stock value mix", center: "Value", slices: [{ label: "Raw material", value: Number(s.rm_value || 0), color: "hsl(var(--chart-1))" }, { label: "WIP", value: Number(s.wip_value || 0), color: "hsl(var(--chart-3))" }, { label: "Finished goods", value: Number(s.fg_value || 0), color: "hsl(var(--chart-7))" }] }
  }
  if (type === "plants") {
    const rows: any[] = data?.rows || []
    return { title: "Inventory value by plant", center: "Value", slices: rows.map((row, i) => ({ label: String(row.plant_code || row.plant_name || "—"), value: Number(row.inventory_value || 0), color: PALETTE[i % PALETTE.length] })) }
  }
  if (type === "dispatch") {
    const s = data?.summary || {}
    const ready = Number(s.ready_job_count || 0)
    const sealed = Number(s.sealed_dispatches || 0)
    return { title: "Gate readiness", center: "Ready jobs", slices: [{ label: "Sealed", value: sealed, color: "hsl(var(--chart-7))" }, { label: "Awaiting seal", value: Math.max(0, ready - sealed), color: "hsl(var(--chart-6))" }] }
  }
  if (type === "exceptions") {
    const s = data?.summary || {}
    return {
      title: "Where the exceptions are",
      center: "Open items",
      slices: [
        { label: "Delayed orders", value: Number(s.delayed_orders || 0), color: "hsl(var(--chart-5))", href: "/sales-orders/pending" },
        { label: "Blocked jobs", value: Number(s.blocked_jobs || 0), color: "hsl(var(--chart-6))", href: "/production/job-cards" },
        { label: "QC holds", value: Number(s.active_qc_holds || 0), color: "hsl(var(--chart-3))", href: "/quality" },
        { label: "Low stock", value: Number(s.low_stock_items || 0), color: "hsl(var(--chart-2))", href: "/inventory/stock-alerts" },
        { label: "Overstock", value: Number(s.overstock_items || 0), color: "hsl(var(--chart-1))" },
      ],
    }
  }
  const totals = chart.keys.map((key, i) => ({ label: key, value: chart.rows.reduce((sum, row) => sum + Number(row[key] || 0), 0), color: PALETTE[i % PALETTE.length] }))
  return { title: "Period mix", center: "Total", slices: totals }
}

function rowHref(row: any) {
  if (row?.job_card_id) return `/production/job-cards/${row.job_card_id}`
  if (row?.order_id) return `/sales-orders/${row.order_id}`
  if (row?.sales_order_id) return `/sales-orders/${row.sales_order_id}`
  return null
}

function downloadCsv(filename: string, columns: string[], rows: any[]) {
  const escape = (value: unknown) => {
    const text = value === null || value === undefined ? "" : typeof value === "object" ? "" : String(value)
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
  }
  const csv = [columns.map(formatLabel).join(","), ...rows.map((row) => columns.map((column) => escape(row[column])).join(","))].join("\n")
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }))
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

const RANGES = [
  { label: "7d", days: 6 },
  { label: "30d", days: 29 },
  { label: "90d", days: 89 },
]

export function ReportDetailPage({ type }: { type: ReportType }) {
  const { activePlant } = useAuth()
  const [startDate, setStartDate] = useState(isoDay(29))
  const [endDate, setEndDate] = useState(isoDay())
  const [tab, setTab] = useState(ROW_SETS[type][0].key)
  const [search, setSearch] = useState("")
  const meta = REPORT_META[type]
  const activePlantLabel = displayPlantScope(activePlant, "No plant selected")
  const query = useQuery({
    queryKey: ["report-detail", type, activePlant, startDate, endDate],
    queryFn: () => fetchReport(type, { start_date: startDate, end_date: endDate, granularity: "day", plant: activePlant }),
  })
  const data: any = useMemo(() => query.data || {}, [query.data])
  const chart = useMemo(() => toChart(data), [data])
  const mix = useMemo(() => breakdown(type, data, chart), [type, data, chart])
  const summaryEntries = Object.entries(data.summary || {}).filter(([key, value]) => typeof value !== "boolean" && typeof value !== "object").slice(0, 8)
  const activeSet = ROW_SETS[type].find((set) => set.key === tab) || ROW_SETS[type][0]
  const allRows: any[] = activeSet.pick(data)
  const columns = useMemo(() => {
    const keys = new Set<string>()
    for (const row of allRows.slice(0, 20)) {
      Object.entries(row || {}).forEach(([key, value]) => {
        if (key.endsWith("_id") || key === "id" || typeof value === "object") return
        keys.add(key)
      })
    }
    return Array.from(keys).slice(0, 8)
  }, [allRows])
  const needle = search.trim().toLowerCase()
  const rows = needle ? allRows.filter((row) => columns.some((column) => String(row?.[column] ?? "").toLowerCase().includes(needle))) : allRows
  const activeRange = RANGES.find((range) => startDate === isoDay(range.days) && endDate === isoDay())?.label

  return (
    <div className="space-y-5" data-testid={`report-detail-${type}`}>
      <PageHeader
        badge={meta.eyebrow}
        title={meta.title}
        description={meta.description}
        actions={
          <>
            <div className="tube-segment print:hidden" role="group" aria-label="Report period">
              {RANGES.map((range) => (
                <button key={range.label} type="button" aria-pressed={activeRange === range.label} onClick={() => { setStartDate(isoDay(range.days)); setEndDate(isoDay()) }}>{range.label}</button>
              ))}
            </div>
            <label className="flex h-9 items-center gap-1.5 rounded-lg border border-input bg-card px-2.5 text-[12.5px] text-muted-foreground">
              From
              <input type="date" aria-label="From date" value={startDate} max={endDate} onChange={(event) => setStartDate(event.target.value)} className="bg-transparent text-[13px] text-foreground outline-none" />
            </label>
            <label className="flex h-9 items-center gap-1.5 rounded-lg border border-input bg-card px-2.5 text-[12.5px] text-muted-foreground">
              To
              <input type="date" aria-label="To date" value={endDate} min={startDate} onChange={(event) => setEndDate(event.target.value)} className="bg-transparent text-[13px] text-foreground outline-none" />
            </label>
            <button type="button" className="erp-btn-secondary !h-9 print:hidden" onClick={() => window.print()}><Printer className="h-4 w-4" />Print</button>
          </>
        }
      />
      <p className="-mt-2 text-[12.5px] text-muted-foreground">Scope: <span className="font-semibold text-foreground">{activePlantLabel}</span> · {startDate} → {endDate}</p>

      {query.isLoading ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">{Array.from({ length: 4 }).map((_, index) => <div key={index} className="skeleton h-[108px] rounded-xl" />)}</div>
          <div className="skeleton h-[340px] rounded-xl" />
        </div>
      ) : query.isError ? (
        <div className="rounded-xl border border-signal-rose-line bg-signal-rose-soft p-6 text-[13.5px] text-signal-rose-ink">
          The report service did not answer for this window. Numbers here must not be read as zero.
          <button type="button" className="erp-btn-secondary ml-3 !h-8" onClick={() => void query.refetch()}>Retry</button>
        </div>
      ) : (
        <>
          <MetricRail className={cn(summaryEntries.length > 4 && "2xl:grid-cols-4")}>
            {summaryEntries.map(([key, value]) => {
              const metric = metricFor(key, value)
              return <MetricCard key={key} label={formatLabel(key.replace(/_percent$/, " %"))} value={metric.value} tone={metric.tone} icon={metric.icon} progress={metric.progress} />
            })}
          </MetricRail>

          <section className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <Panel title="Trend" subtitle={chart.keys.length ? `Daily ${chart.keys.join(", ").toLowerCase()} for the window.` : "Daily movement for the window."}>
              <div className="h-[300px]">
                {chart.rows.length && chart.keys.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chart.rows} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                      <defs>
                        {chart.keys.map((key, index) => (
                          <linearGradient key={key} id={`rd-${type}-${index}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={PALETTE[index % PALETTE.length]} stopOpacity={0.28} />
                            <stop offset="100%" stopColor={PALETTE[index % PALETTE.length]} stopOpacity={0} />
                          </linearGradient>
                        ))}
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="bucket" tickLine={false} axisLine={false} minTickGap={18} />
                      <YAxis tickLine={false} axisLine={false} width={48} tickFormatter={(value) => formatCompactNumber(Number(value))} />
                      <Tooltip content={<ChartTooltip />} />
                      <Legend iconType="circle" iconSize={8} />
                      {chart.keys.map((key, index) => (
                        <Area key={key} type="monotone" dataKey={key} stroke={PALETTE[index % PALETTE.length]} strokeWidth={2} fill={`url(#rd-${type}-${index})`} animationDuration={900} />
                      ))}
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <ChartEmptyState label="No movement recorded in this window." />
                )}
              </div>
            </Panel>
            <Panel title={mix.title} subtitle="Hover a slice to focus it; linked slices open the source list.">
              <Donut
                slices={mix.slices}
                centerLabel={mix.center}
                format={mix.center === "Value" ? (value) => formatCompactCurrency(value) : undefined}
              />
            </Panel>
          </section>

          <Panel
            title="Detail rows"
            subtitle={`${rows.length.toLocaleString("en-IN")} of ${allRows.length.toLocaleString("en-IN")} rows · use the arrow to open the source record.`}
            actions={
              <div className="flex flex-wrap items-center gap-2 print:hidden">
                <div className="flex h-9 items-center gap-2 rounded-lg border border-input bg-card px-2.5 focus-within:ring-2 focus-within:ring-ring/30">
                  <Search className="h-4 w-4 text-muted-foreground" />
                  <input aria-label="Search rows" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filter rows…" className="w-36 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground sm:w-48" />
                </div>
                <button type="button" className="erp-btn-secondary !h-9" disabled={!rows.length} onClick={() => downloadCsv(`${type}-${activeSet.key}-${endDate}.csv`, columns, rows)}><Download className="h-4 w-4" />CSV</button>
              </div>
            }
          >
            {ROW_SETS[type].length > 1 ? (
              <div className="tube-segment mb-3 print:hidden" role="tablist" aria-label="Row set">
                {ROW_SETS[type].map((set) => (
                  <button key={set.key} type="button" role="tab" aria-selected={tab === set.key} onClick={() => { setTab(set.key); setSearch("") }}>
                    {set.label} <span className="ml-1 tabular-nums text-muted-foreground">{set.pick(data).length}</span>
                  </button>
                ))}
              </div>
            ) : null}
            {rows.length ? (
              <div className="tube-print-expand max-h-[520px] overflow-auto rounded-lg border border-border">
                <table className="tube-grid">
                  <thead>
                    <tr>
                      {columns.map((column) => {
                        const numeric = rows.some((row) => typeof row?.[column] === "number")
                        return <th key={column} className={numeric ? "num" : undefined}>{formatLabel(column)}</th>
                      })}
                      <th aria-label="Open" className="w-8 print:hidden" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, index) => {
                      const href = rowHref(row)
                      return (
                        <tr key={index}>
                          {columns.map((column) => {
                            const value = column === "plant_id" || column === "plant" ? displayPlantScope(row[column], "—") : formatCell(row[column])
                            return <td key={column} className={typeof row?.[column] === "number" ? "num" : undefined}>{value}</td>
                          })}
                          <td className="print:hidden">{href ? <Link href={href} aria-label="Open source record" className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"><ArrowUpRight className="h-3.5 w-3.5" /></Link> : null}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-border py-10 text-center text-[13px] text-muted-foreground">{needle ? "No rows match that filter." : "Nothing in this list for the selected window."}</p>
            )}
          </Panel>
        </>
      )}
    </div>
  )
}
