"use client"

import { Activity, AlertTriangle, BarChart3, Boxes, Gauge, ScrollText } from "lucide-react"
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts"

import { ChartBox, ChartEmptyState, ChartPanel, ChartTooltip } from "@/components/erp/charts"
import { Panel, StatusBadge } from "@/components/erp/shell"

type OwnerCommandCenterProps = {
  report?: any
  printHref?: string
}

type MetricModule = {
  label: string
  value: string
  Icon: typeof Activity
}

function numberLabel(value: any, suffix = "") {
  const parsed = Number(value || 0)
  return `${Number.isFinite(parsed) ? parsed.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "0"}${suffix}`
}

function humanize(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())
}

function flattenSections(data: any) {
  const sections: Array<{ key: string; rows: any[] }> = []
  Object.entries(data || {}).forEach(([key, value]) => {
    if (Array.isArray(value) && value.length > 0 && typeof value[0] === "object") {
      sections.push({ key, rows: value })
      return
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      Object.entries(value).forEach(([nestedKey, nestedValue]) => {
        if (Array.isArray(nestedValue) && nestedValue.length > 0 && typeof nestedValue[0] === "object") {
          sections.push({ key: `${key}.${nestedKey}`, rows: nestedValue })
        }
      })
    }
  })
  return sections
}

function numericColumns(rows: any[]) {
  if (!Array.isArray(rows) || rows.length === 0) return []
  const keys = Object.keys(rows[0] || {})
  return keys.filter((key) => rows.some((row) => typeof row?.[key] === "number")).slice(0, 3)
}

function labelColumn(rows: any[]) {
  if (!Array.isArray(rows) || rows.length === 0) return null
  const candidates = ["date", "label", "plant_name", "plant", "stage", "name", "machine_name", "item_code", "bucket"]
  const row = rows[0] || {}
  return candidates.find((candidate) => candidate in row) || Object.keys(row).find((key) => typeof row[key] === "string") || null
}

const palette = ["#0f766e", "#1d4ed8", "#b45309", "#7c3aed", "#be123c"]

export function OwnerCommandCenter({ report, printHref }: OwnerCommandCenterProps) {
  const headline = report?.headline || {}
  const sections = flattenSections(report)
  const primarySeries = sections.find((section) => section.key.includes("series"))?.rows || []
  const secondarySeries =
    sections.find((section) => section.key !== "series" && numericColumns(section.rows).length > 0)?.rows || []
  const primaryLabel = labelColumn(primarySeries)
  const secondaryLabel = labelColumn(secondarySeries)
  const primaryMetrics = numericColumns(primarySeries)
  const secondaryMetrics = numericColumns(secondarySeries)
  const topAlerts = [
    ...(Array.isArray(report?.blocked_jobs) ? report.blocked_jobs : []),
    ...(Array.isArray(report?.delayed_orders) ? report.delayed_orders : []),
    ...(Array.isArray(report?.exceptions) ? report.exceptions : []),
  ].slice(0, 5)
  const modules: MetricModule[] = [
    { label: "Open WIP", value: numberLabel(headline.open_wip || report?.summary?.open_wip), Icon: Activity },
    { label: "Today Output", value: numberLabel(headline.today_output || report?.summary?.today_output), Icon: Boxes },
    { label: "Scrap", value: numberLabel(headline.scrap_pct || report?.summary?.scrap_pct, "%"), Icon: AlertTriangle },
    { label: "OEE", value: numberLabel(headline.oee_pct || report?.summary?.oee_pct, "%"), Icon: Gauge },
  ]

  return (
    <div data-testid="analytics-owner-pack-page" className="space-y-6">
      <section className="rounded-[2rem] border border-slate-200 bg-[linear-gradient(135deg,#0f172a_0%,#162336_45%,#0f766e_100%)] p-8 text-white shadow-xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-4xl">
            <p className="text-xs font-black uppercase tracking-[0.35em] text-cyan-200">Owner Pack</p>
            <h1 className="mt-3 text-3xl font-black tracking-tight">Command center</h1>
            <p className="mt-3 max-w-3xl text-sm font-medium leading-6 text-slate-200">
              Consolidated production, sales, inventory, quality, and reconciliation posture. This page should read like a control pack, not a raw export.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge value={report?.status || "ACTIVE"} label={report?.status_label || "Live reporting"} />
            {printHref ? (
              <a
                href={printHref}
                className="inline-flex rounded-full bg-white px-5 py-2 text-xs font-black uppercase tracking-[0.2em] text-slate-950"
              >
                Print pack
              </a>
            ) : null}
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-4">
        {modules.map(({ label, value, Icon: MetricIcon }) => {
          return (
            <article key={label} className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.25em] text-slate-400">{label}</p>
                  <p className="mt-3 text-2xl font-black text-slate-950">{value}</p>
                </div>
                <div className="rounded-2xl bg-slate-100 p-2.5 text-slate-700">
                  <MetricIcon className="h-4 w-4" />
                </div>
              </div>
            </article>
          )
        })}
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <ChartPanel title="Executive Trend" subtitle="Primary owner-pack series rendered as a board-level trend, not just a metric table.">
          <div className="h-full">
            {!primarySeries.length || !primaryLabel || primaryMetrics.length === 0 ? (
              <ChartEmptyState label="No primary owner-pack series is available yet." />
            ) : (
              <ChartBox>
                <LineChart data={primarySeries}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#dbe4ee" />
                  <XAxis dataKey={primaryLabel} stroke="#64748b" />
                  <YAxis stroke="#64748b" />
                  <ChartTooltip />
                  {primaryMetrics.map((metric, index) => (
                    <Line key={metric} type="monotone" dataKey={metric} name={humanize(metric)} stroke={palette[index % palette.length]} strokeWidth={2.5} dot={false} />
                  ))}
                </LineChart>
              </ChartBox>
            )}
          </div>
        </ChartPanel>

        <Panel title="Attention Radar" subtitle="Owner-facing high-signal issues that still need intervention.">
          <div className="space-y-3">
            {topAlerts.length === 0 ? (
              <div className="rounded-[1.25rem] border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                No active board-level exceptions are present in the current owner pack.
              </div>
            ) : (
              topAlerts.map((row: any, index: number) => (
                <div key={`${row?.id || row?.job_card_id || row?.order_id || index}`} className="rounded-[1.2rem] border border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="text-sm font-semibold text-slate-900">
                    {row?.job_card_ref || row?.order_no || row?.item_code || `Issue ${index + 1}`}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {row?.customer_name || row?.item_name || row?.plant_name || "Operational exception"}
                  </p>
                  <p className="mt-2 text-sm text-slate-700">
                    {row?.blocked_reason || row?.reason || row?.detail || row?.status || "Needs attention"}
                  </p>
                </div>
              ))
            )}
          </div>
        </Panel>
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <ChartPanel title="Distribution / Mix" subtitle="Secondary mix chart from live owner-pack sections such as plants, routes, or stock posture.">
          <div className="h-full">
            {!secondarySeries.length || !secondaryLabel || secondaryMetrics.length === 0 ? (
              <ChartEmptyState label="No secondary owner-pack chart section is available yet." />
            ) : (
              <ChartBox>
                <BarChart data={secondarySeries}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#dbe4ee" />
                  <XAxis dataKey={secondaryLabel} stroke="#64748b" />
                  <YAxis stroke="#64748b" />
                  <ChartTooltip />
                  {secondaryMetrics.map((metric, index) => (
                    <Bar key={metric} dataKey={metric} name={humanize(metric)} fill={palette[index % palette.length]} radius={[8, 8, 0, 0]} />
                  ))}
                </BarChart>
              </ChartBox>
            )}
          </div>
        </ChartPanel>

        <Panel title="Filter Preset" subtitle="The active owner-pack filter context that downstream reports inherit.">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-[1.25rem] border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-black uppercase tracking-[0.3em] text-cyan-800">Active Preset</p>
              <p data-testid="analytics-filter:active-preset" className="mt-2 text-sm font-black text-slate-950">
                All plants and current reporting window
              </p>
            </div>
            <button
              data-testid="analytics-filter:preset:all"
              type="button"
              className="rounded-[1.25rem] border border-slate-200 bg-white px-4 py-4 text-left text-sm font-semibold text-slate-700"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Preset</p>
                  <p className="mt-2 text-slate-950">All plants</p>
                </div>
                <ScrollText className="h-4 w-4 text-slate-500" />
              </div>
            </button>
          </div>
        </Panel>
      </div>
    </div>
  )
}

export default OwnerCommandCenter
