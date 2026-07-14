"use client"

import Link from "next/link"
import { AlertTriangle, ClipboardList } from "lucide-react"

import { KpiRail, Panel, ReportHero, formatNumber } from "@/components/reports/primitives"
import { useToolReport } from "@/hooks/use-master-data"
import { useToolAssetReport } from "@/hooks/use-inventory"
import { TOOL_CATEGORY_LABELS } from "@/lib/spec-sheet"

const CATEGORY_LABELS = TOOL_CATEGORY_LABELS

function formatDate(value: any) {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  return date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })
}

function eventTone(eventType: string) {
  if (eventType === "SCRAP") return "text-rose-700"
  if (eventType === "MAINTENANCE") return "text-amber-700"
  if (eventType === "PRODUCTION_USED") return "text-cyan-800"
  return "text-slate-700"
}

export default function ToolingReportPage() {
  const { data, isLoading } = useToolReport()
  const { data: assetData, isLoading: assetsLoading } = useToolAssetReport()
  const summary = (data as any)?.summary || {}
  const byCategory = ((data as any)?.by_category || []) as any[]
  const usage = ((data as any)?.usage || []) as any[]
  const recentLogs = ((data as any)?.recent_logs || []) as any[]
  const maintenanceCount = Number(summary.maintenance || 0)
  const scrapCount = Number(summary.scrap || 0)
  const physicalSummary = (assetData as any)?.summary || {}
  const physicalCategories = ((assetData as any)?.by_category || []) as any[]
  const assetOutput = ((assetData as any)?.asset_output || []) as any[]
  const grindCycles = ((assetData as any)?.grind_cycles || []) as any[]

  return (
    <div className="space-y-5 px-6 pb-10 pt-2" data-testid="tooling-report-page">
      <ReportHero
        eyebrow="Operations report"
        title="Tooling Ledger"
        description="Definition masters, inwarded QR assets, location, issue/return, grinding cycles, and actual production output in one trace."
        accent="cyan"
        chips={[
          { label: `${formatNumber(Number(physicalSummary.total_assets || 0))} physical assets`, tone: "neutral" },
          { label: `${formatNumber(Number(physicalSummary.available || 0))} available`, tone: physicalSummary.available ? "ok" : "warn" },
          { label: `${formatNumber(Number(physicalSummary.grinding_out || 0))} grinding out`, tone: physicalSummary.grinding_out ? "warn" : "neutral" },
        ]}
      />

      <KpiRail
        columns={4}
        items={[
          { label: "Active definitions", value: formatNumber(Number(summary.active || 0)), tone: "emerald", detail: "Visible in spec dropdowns" },
          { label: "Available assets", value: formatNumber(Number(physicalSummary.available || 0)), tone: "cyan", detail: "Ready for issue" },
          { label: "Grinding cycles", value: formatNumber(Number(physicalSummary.grinding_out || 0)), tone: "amber", detail: "Blade assets outside" },
          { label: "Actual output", value: formatNumber(Number(physicalSummary.produced_qty || 0)), tone: "slate", detail: "Recorded against QR assets" },
        ]}
      />

      <div className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
        <Panel
          eyebrow="Availability"
          title="Category Status Matrix"
          description="Master definitions stay separate from physical asset status and location."
          actions={
            <Link href="/masters/tools" className="text-sm font-semibold text-cyan-800 hover:underline">
              Manage tools
            </Link>
          }
        >
          {isLoading ? (
            <div className="py-6 text-sm text-slate-500">Loading tooling report...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                    <th className="py-2 pr-3">Category</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3 text-right">Count</th>
                    <th className="py-2 pr-3 text-right">Usage</th>
                  </tr>
                </thead>
                <tbody>
                  {byCategory.map((row, index) => (
                    <tr key={`${row.category}-${row.status}-${index}`} className="border-b border-slate-100">
                      <td className="py-2 pr-3 font-medium text-slate-900">{CATEGORY_LABELS[row.category] || row.category}</td>
                      <td className="py-2 pr-3 text-slate-700">{row.status}</td>
                      <td className="py-2 pr-3 text-right font-semibold text-slate-950">{formatNumber(Number(row.count || 0))}</td>
                      <td className="py-2 pr-3 text-right text-slate-700">{formatNumber(Number(row.usage_count || 0))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel
          eyebrow="Trace"
          title="Top Usage"
          description="Grouped by category, tool value, and event type."
        >
          <div className="space-y-3">
            {usage.slice(0, 10).map((row, index) => (
              <div key={`${row.category}-${row.tool_name}-${row.event_type}-${index}`} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-950">{CATEGORY_LABELS[row.category] || row.category}: {row.tool_name}</p>
                    <p className={`mt-1 text-xs font-semibold ${eventTone(row.event_type)}`}>{row.event_type}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-semibold text-slate-950">{formatNumber(Number(row.count || 0))}</p>
                    <p className="text-xs text-slate-500">{formatNumber(Number(row.production_qty || 0))} planned pcs</p>
                  </div>
                </div>
                <p className="mt-2 text-xs text-slate-500">Last event {formatDate(row.last_used_at)}</p>
              </div>
            ))}
            {!usage.length ? (
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-6 text-sm text-slate-500">No tooling usage has been logged yet.</div>
            ) : null}
          </div>
        </Panel>
      </div>

      <Panel eyebrow="Physical assets" title="Asset output by category" description="Actual completed-stage output is aggregated from QR asset usage events; no planned quantity is substituted.">
        {assetsLoading ? <div className="py-6 text-sm text-slate-500">Loading physical asset report...</div> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-slate-200 text-left text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500"><th className="py-2 pr-3">Category</th><th className="py-2 pr-3 text-right">Assets</th><th className="py-2 pr-3 text-right">Available</th><th className="py-2 pr-3 text-right">Issued</th><th className="py-2 pr-3 text-right">Grinding</th><th className="py-2 pr-3 text-right">Scrap</th><th className="py-2 text-right">Actual output</th></tr></thead><tbody>{physicalCategories.map((row) => <tr key={row.category} className="border-b border-slate-100"><td className="py-2 pr-3 font-semibold text-slate-900">{CATEGORY_LABELS[row.category] || row.category}</td><td className="py-2 pr-3 text-right">{formatNumber(Number(row.assets || 0))}</td><td className="py-2 pr-3 text-right">{formatNumber(Number(row.available || 0))}</td><td className="py-2 pr-3 text-right">{formatNumber(Number(row.issued || 0))}</td><td className="py-2 pr-3 text-right">{formatNumber(Number(row.grinding_out || 0))}</td><td className="py-2 pr-3 text-right">{formatNumber(Number(row.scrap || 0))}</td><td className="py-2 text-right font-semibold">{formatNumber(Number(row.produced_qty || 0))}</td></tr>)}</tbody></table></div>}
      </Panel>

      <Panel eyebrow="Blade accountability" title="Lifetime output by physical tool" description="Lifetime accepted and scrap output for each permanent QR asset. Use the cycle register below for output between grinding returns.">
        {assetsLoading ? <div className="py-6 text-sm text-slate-500">Loading asset output...</div> : <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-sm"><thead><tr className="border-b border-slate-200 text-left text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500"><th className="py-2 pr-3">Asset / QR</th><th className="py-2 pr-3">Tool</th><th className="py-2 pr-3">Category</th><th className="py-2 pr-3">Version</th><th className="py-2 pr-3 text-right">Usage runs</th><th className="py-2 pr-3 text-right">Good output</th><th className="py-2 pr-3 text-right">Scrap output</th><th className="py-2">Status</th></tr></thead><tbody>{assetOutput.map((row) => <tr key={row.asset_no} className="border-b border-slate-100"><td className="py-2 pr-3"><p className="font-semibold text-slate-950">{row.asset_no}</p><p className="text-xs text-slate-500">{row.qr_value}</p></td><td className="py-2 pr-3">{row.definition_name}</td><td className="py-2 pr-3">{CATEGORY_LABELS[row.category] || row.category}</td><td className="py-2 pr-3">V{row.grind_version || 0}</td><td className="py-2 pr-3 text-right">{formatNumber(Number(row.usage_count || 0))}</td><td className="py-2 pr-3 text-right font-semibold text-emerald-800">{formatNumber(Number(row.produced_qty || 0))}</td><td className="py-2 pr-3 text-right text-rose-700">{formatNumber(Number(row.scrap_qty || 0))}</td><td className="py-2">{row.status}</td></tr>)}</tbody></table>{!assetOutput.length ? <div className="py-5 text-sm text-slate-500">No inwarded physical tools yet.</div> : null}</div>}
      </Panel>

      <Panel eyebrow="Grinding trace" title="Output by blade grinding version" description="Each grinding return starts the next version. This register preserves production completed before and after every sharpening cycle.">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead><tr className="border-b border-slate-200 text-left text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500"><th className="py-2 pr-3">Asset</th><th className="py-2 pr-3">Tool</th><th className="py-2 pr-3">Cycle</th><th className="py-2 pr-3 text-right">Runs</th><th className="py-2 pr-3 text-right">Good tubes</th><th className="py-2 pr-3 text-right">Scrap tubes</th><th className="py-2">Last used</th></tr></thead>
            <tbody>{grindCycles.map((row) => <tr key={`${row.asset_no}-${row.grind_version}`} className="border-b border-slate-100"><td className="py-2 pr-3"><p className="font-semibold text-slate-950">{row.asset_no}</p><p className="text-xs text-slate-500">{row.qr_value}</p></td><td className="py-2 pr-3">{row.definition_name}</td><td className="py-2 pr-3 font-semibold">Grinding V{row.grind_version || 0}</td><td className="py-2 pr-3 text-right">{formatNumber(Number(row.usage_count || 0))}</td><td className="py-2 pr-3 text-right font-semibold text-emerald-800">{formatNumber(Number(row.produced_qty || 0))}</td><td className="py-2 pr-3 text-right text-rose-700">{formatNumber(Number(row.scrap_qty || 0))}</td><td className="py-2 text-slate-600">{formatDate(row.last_used_at)}</td></tr>)}</tbody>
          </table>
          {!grindCycles.length ? <div className="py-5 text-sm text-slate-500">Cycle output will appear after an issued physical tool is used on a completed job-card stage.</div> : null}
        </div>
      </Panel>

      <Panel
        eyebrow="Ledger"
        title="Recent Tool Trace"
        description="Definition selections remain as design history. Actual production usage is recorded in the physical asset report above."
        actions={
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
            <ClipboardList className="h-4 w-4" />
            Last {recentLogs.length} events
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                <th className="py-2 pr-3">Time</th>
                <th className="py-2 pr-3">Category</th>
                <th className="py-2 pr-3">Tool</th>
                <th className="py-2 pr-3">Event</th>
                <th className="py-2 pr-3">Source</th>
                <th className="py-2 pr-3">Reference</th>
                <th className="py-2 pr-3">Notes</th>
              </tr>
            </thead>
            <tbody>
              {recentLogs.map((log) => (
                <tr key={log.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="py-2 pr-3 text-slate-500">{formatDate(log.created_at)}</td>
                  <td className="py-2 pr-3 text-slate-700">{CATEGORY_LABELS[log.category] || log.category}</td>
                  <td className="py-2 pr-3 font-medium text-slate-950">{log.tool_name}</td>
                  <td className={`py-2 pr-3 font-semibold ${eventTone(log.event_type)}`}>{log.event_type}</td>
                  <td className="py-2 pr-3 text-slate-700">{log.source_type}</td>
                  <td className="py-2 pr-3 text-slate-700">{log.source_ref || log.source_id || "-"}</td>
                  <td className="py-2 pr-3 text-slate-500">{log.notes || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!recentLogs.length ? (
            <div className="mt-3 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <AlertTriangle className="h-4 w-4" />
              Tool logs will appear after spec sheets are saved or production job cards are released.
            </div>
          ) : null}
        </div>
      </Panel>
    </div>
  )
}
