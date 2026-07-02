"use client"

import Link from "next/link"
import { AlertTriangle, ClipboardList } from "lucide-react"

import { KpiRail, Panel, ReportHero, formatNumber } from "@/components/reports/primitives"
import { useToolReport } from "@/hooks/use-master-data"
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
  const summary = (data as any)?.summary || {}
  const byCategory = ((data as any)?.by_category || []) as any[]
  const usage = ((data as any)?.usage || []) as any[]
  const recentLogs = ((data as any)?.recent_logs || []) as any[]
  const maintenanceCount = Number(summary.maintenance || 0)
  const scrapCount = Number(summary.scrap || 0)

  return (
    <div className="space-y-5 px-6 pb-10 pt-2" data-testid="tooling-report-page">
      <ReportHero
        eyebrow="Operations report"
        title="Tooling Ledger"
        description="One view for notch tool availability, maintenance/scrap status, spec-sheet selections, and job-card usage trace."
        accent="cyan"
        chips={[
          { label: `${formatNumber(Number(summary.total_tools || 0))} tools`, tone: "neutral" },
          { label: `${formatNumber(maintenanceCount)} maintenance`, tone: maintenanceCount ? "warn" : "ok" },
          { label: `${formatNumber(scrapCount)} scrap`, tone: scrapCount ? "critical" : "neutral" },
        ]}
      />

      <KpiRail
        columns={4}
        items={[
          { label: "Active tools", value: formatNumber(Number(summary.active || 0)), tone: "emerald", detail: "Visible in spec dropdowns" },
          { label: "Maintenance", value: formatNumber(maintenanceCount), tone: maintenanceCount ? "amber" : "slate", detail: "Hidden from future spec use" },
          { label: "Scrap", value: formatNumber(scrapCount), tone: scrapCount ? "rose" : "slate", detail: "Historical trace retained" },
          { label: "Usage rows", value: formatNumber(usage.length), tone: "cyan", detail: "Spec and job-card events" },
        ]}
      />

      <div className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
        <Panel
          eyebrow="Availability"
          title="Category Status Matrix"
          description="Only ACTIVE records are shown inside the spec sheet. Maintenance and scrap remain reportable here."
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

      <Panel
        eyebrow="Ledger"
        title="Recent Tool Trace"
        description="Spec selections and production job-card usage appear here with source references."
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
