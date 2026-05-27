"use client"

import { useMemo } from "react"

import { RoleGate } from "@/components/workspace/role-gate"
import {
  DrillLink,
  KpiRail,
  MiniLadder,
  NoteCallout,
  Panel,
  ParetoChart,
  Pill,
  ReportFilterBar,
  ReportHero,
  FilterField,
  Waterfall,
  formatCurrency,
  formatNumber,
  formatPct,
} from "@/components/reports/primitives"
import { useAuth } from "@/context/AuthContext"
import { useOwnerPack, useScrapCostLadder } from "@/hooks/use-analytics"

export default function VarianceWrapper() {
  return (
    <RoleGate allow={["PlantManager", "Planner", "Owner", "Admin", "Quality"]}>
      <VarianceBridgePage />
    </RoleGate>
  )
}

function VarianceBridgePage() {
  const { activePlant } = useAuth()
  const today = new Date().toISOString().split("T")[0]
  const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]

  const { data: pack } = useOwnerPack(activePlant ? { plant: activePlant } : undefined, { enabled: true })
  const { data: scrap, isLoading: scrapLoading } = useScrapCostLadder({ startDate, endDate: today, plant: activePlant || undefined })

  const p: any = pack || {}
  const reconciliation = p.reconciliation || {}
  const summary = reconciliation.summary || {}

  // 6-bar waterfall
  const theoretical = Number(summary.theoretical_kg || 0)
  const overIssue = Number(summary.over_issue_kg || 0)
  const recovery = Number(summary.recovery_kg || 0)
  const moisture = Number(summary.moisture_kg || 0)
  const scrapKg = Number(summary.scrap_kg || 0)
  const actual = Number(summary.actual_kg || (theoretical - overIssue + recovery - moisture - scrapKg))

  const bars = useMemo(
    () =>
      [
        { label: "Theoretical", value: theoretical, total: true, tone: "anchor" as const },
        overIssue ? { label: "Over-issue", value: -overIssue, tone: "negative" as const } : null,
        recovery ? { label: "Recovery", value: recovery, tone: "positive" as const } : null,
        moisture ? { label: "Moisture", value: -moisture, tone: "negative" as const } : null,
        scrapKg ? { label: "Scrap", value: -scrapKg, tone: "negative" as const } : null,
        { label: "Actual", value: actual, total: true, tone: "anchor" as const },
      ].filter(Boolean) as any[],
    [theoretical, overIssue, recovery, moisture, scrapKg, actual],
  )

  const variancePct = theoretical > 0 ? ((actual - theoretical) / theoretical) * 100 : 0
  const varianceValue = Number(summary.variance_value || 0)

  const scrapRows: any[] = Array.isArray((scrap as any)?.rows) ? (scrap as any).rows : []
  const scrapSummary = (scrap as any)?.summary || {}
  const paretoBars = scrapRows.slice(0, 8).map((r: any) => ({ label: r.reason, value: Number(r.value_inr || 0) }))

  const itemRows: any[] = Array.isArray(reconciliation.items) ? reconciliation.items : []
  const rawQcPass = Number(summary.qc_pass_percent)
  const qcPassPercent = Number.isFinite(rawQcPass) && rawQcPass > 0 ? rawQcPass : null

  return (
    <div className="space-y-5 px-6 pb-10 pt-2" data-testid="reports-variance-page">
      <ReportHero
        eyebrow="Quality & variance bridge"
        title="Where did the kg go — theoretical → ledger drift → recovery → actual."
        description="Full 6-bar waterfall, 3-stream item table, QC Pareto, scrap ladder. Same data as the close ritual, prettier shape."
        accent="violet"
        chips={[
          { label: `Variance ${formatPct(variancePct, 2)}`, tone: Math.abs(variancePct) > 5 ? "critical" : "neutral" },
          { label: `${formatCurrency(varianceValue)} drift`, tone: varianceValue > 100_000 ? "critical" : "neutral" },
          { label: `${formatNumber(scrapRows.length)} scrap reasons`, tone: "neutral" },
          { label: `Pass ${qcPassPercent === null ? "—" : formatPct(qcPassPercent)}`, tone: qcPassPercent === null ? "neutral" : qcPassPercent >= 95 ? "ok" : "warn" },
        ]}
      />

      <ReportFilterBar>
        <FilterField label="Window">
          <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-sm font-semibold text-slate-700">Last 30 days</span>
        </FilterField>
        <FilterField label="Plant">
          <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-sm font-semibold text-slate-700">{activePlant || "ALL"}</span>
        </FilterField>
      </ReportFilterBar>

      <KpiRail
        items={[
          { label: "Theoretical kg", value: `${formatNumber(theoretical, 0)} kg`, tone: "slate" },
          { label: "Actual kg", value: `${formatNumber(actual, 0)} kg`, tone: "cyan" },
          { label: "Variance %", value: formatPct(variancePct, 2), tone: Math.abs(variancePct) > 5 ? "rose" : "emerald" },
          { label: "Variance ₹", value: formatCurrency(varianceValue), tone: "amber" },
          { label: "Scrap ₹", value: formatCurrency(Number(scrapSummary.total_value_inr || 0)), tone: "rose" },
          { label: "QC pass", value: qcPassPercent === null ? "—" : formatPct(qcPassPercent), tone: qcPassPercent === null ? "slate" : qcPassPercent >= 95 ? "emerald" : "amber" },
        ]}
      />

      <Panel eyebrow="The bridge" title="Theoretical → actual (kg)" description="Each step is the named loss or recovery that moved the totals.">
        {bars.length >= 2 ? (
          <Waterfall bars={bars} unit="kg" />
        ) : (
          <NoteCallout tone="neutral">Reconciliation snapshot is not yet available for this window.</NoteCallout>
        )}
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
        <Panel eyebrow="Scrap reasons (Pareto)" title="Where the scrap cost is concentrated" description="The first few reasons typically account for 80% of cost.">
          {scrapLoading ? <NoteCallout tone="neutral">Loading scrap ladder…</NoteCallout> : paretoBars.length ? <ParetoChart bars={paretoBars} /> : <NoteCallout tone="ok">No scrap events in this window.</NoteCallout>}
        </Panel>
        <Panel eyebrow="Scrap cost ladder" title="By reason" description="Cost-weighted ladder of scrap reasons.">
          {scrapRows.length ? (
            <MiniLadder
              rows={scrapRows.slice(0, 8).map((r: any) => ({ label: r.reason, value: Number(r.value_inr || 0), tone: r.cumulative_pct < 50 ? "critical" : r.cumulative_pct < 80 ? "warn" : "ok" }))}
              formatter={(v) => formatCurrency(v)}
            />
          ) : (
            <NoteCallout tone="ok">No scrap entries in window.</NoteCallout>
          )}
        </Panel>
      </div>

      <Panel eyebrow="3-stream item table" title="Per-item theoretical / ledger / actual" description="Each row shows where the planning math, the ledger, and the floor truth diverge.">
        {itemRows.length ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="py-2 pr-3">Item</th>
                <th className="py-2 pr-3 text-right">Theoretical</th>
                <th className="py-2 pr-3 text-right">Ledger</th>
                <th className="py-2 pr-3 text-right">Actual</th>
                <th className="py-2 pr-3 text-right">Drift</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3" />
              </tr>
            </thead>
            <tbody>
              {itemRows.slice(0, 12).map((row: any, i: number) => {
                const drift = Number(row.actual || 0) - Number(row.theoretical || 0)
                const driftPct = Number(row.theoretical || 0) ? (drift / Number(row.theoretical)) * 100 : 0
                const tone: "ok" | "warn" | "critical" = Math.abs(driftPct) > 5 ? "critical" : Math.abs(driftPct) > 2 ? "warn" : "ok"
                return (
                  <tr key={i} className="border-b border-slate-100">
                    <td className="py-2 pr-3 font-mono text-xs">{row.item_code || row.name}</td>
                    <td className="py-2 pr-3 text-right">{formatNumber(Number(row.theoretical || 0))}</td>
                    <td className="py-2 pr-3 text-right">{formatNumber(Number(row.ledger || row.consumed || 0))}</td>
                    <td className="py-2 pr-3 text-right">{formatNumber(Number(row.actual || 0))}</td>
                    <td className={`py-2 pr-3 text-right font-bold ${drift < 0 ? "text-rose-700" : drift > 0 ? "text-emerald-700" : ""}`}>
                      {drift > 0 ? "+" : ""}{formatNumber(drift)}
                    </td>
                    <td className="py-2 pr-3"><Pill tone={tone}>{tone === "critical" ? "REVIEW" : tone === "warn" ? "WATCH" : "OK"}</Pill></td>
                    <td className="py-2 pr-3"><DrillLink href={`/inventory/items?code=${row.item_code || ""}`}>Ledger</DrillLink></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        ) : (
          <NoteCallout tone="neutral">Reconciliation item rows are not yet populated for this window.</NoteCallout>
        )}
      </Panel>
    </div>
  )
}
