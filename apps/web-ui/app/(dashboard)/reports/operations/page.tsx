"use client"

import { useMemo } from "react"

import { RoleGate } from "@/components/workspace/role-gate"
import {
  CalendarHeatmap,
  DrillLink,
  KpiRail,
  MiniLadder,
  NoteCallout,
  Panel,
  Pill,
  ReportFilterBar,
  ReportHero,
  FilterField,
  formatNumber,
  formatPct,
} from "@/components/reports/primitives"
import { useAuth } from "@/context/AuthContext"
import { useMachineUtilization, useOperatorProductivity, useOwnerPack } from "@/hooks/use-analytics"
import { useDataEntryLag, useDowntime, useShortCloses } from "@/hooks/use-production"
import { usePlantScopeLabel } from "@/hooks/use-plant-scope-label"

export default function OperationsCommandWrapper() {
  return (
    <RoleGate allow={["PlantManager", "Planner", "Owner", "Admin"]}>
      <OperationsCommandPage />
    </RoleGate>
  )
}

function OperationsCommandPage() {
  const { activePlant } = useAuth()
  const activePlantLabel = usePlantScopeLabel(activePlant)
  const today = new Date().toISOString().split("T")[0]
  const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]

  const { data: util, isLoading: utilLoading } = useMachineUtilization({ startDate, endDate: today, plant: activePlant || undefined })
  const { data: operators } = useOperatorProductivity({ startDate, endDate: today, plant: activePlant || undefined })
  const { data: pack } = useOwnerPack(activePlant ? { plant: activePlant } : undefined, { enabled: true })
  const { data: lag } = useDataEntryLag({ start_date: startDate, end_date: today, threshold_hours: 6 })
  const { data: downtimeRows } = useDowntime({ start_date: startDate, end_date: today })
  const { data: shortCloses } = useShortCloses({ start_date: startDate, end_date: today })

  const p: any = pack || {}
  const production = p.production || {}
  const headline = p.headline || {}
  const blockedRows = Array.isArray(production.blocked_rows) ? production.blocked_rows : []
  const operatorRows: any[] = Array.isArray((operators as any)?.rows) ? (operators as any).rows : []
  const operatorSummary = (operators as any)?.summary || {}
  const rawAdherence = Number(headline.adherence_percent)
  const adherencePercent = Number.isFinite(rawAdherence) && rawAdherence > 0 ? rawAdherence : null

  const machines: any[] = Array.isArray((util as any)?.machines) ? (util as any).machines : []
  const dayLabels: string[] = Array.isArray((util as any)?.day_labels) ? (util as any).day_labels : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
  const hourLabels: string[] = Array.isArray((util as any)?.hour_labels) ? (util as any).hour_labels : Array.from({ length: 24 }).map((_, i) => `${i.toString().padStart(2, "0")}`)

  // build a heatmap for the top machine (or all combined)
  const topMachine = machines[0]
  const heatmapValues = useMemo(() => {
    if (!topMachine?.heatmap) return Array.from({ length: 7 * 24 }).map(() => 0)
    const flat: number[] = []
    for (const row of topMachine.heatmap) {
      for (const cell of row) flat.push(Number(cell) || 0)
    }
    return flat
  }, [topMachine])

  const stagePipeline = Array.isArray(production.stage_pipeline)
    ? production.stage_pipeline.map((row: any) => ({
        label: row.stage || row.stage_type || "Stage",
        value: Number(row.count || row.value || 0),
        tone: Number(row.count || 0) > 12 ? "warn" : "ok",
      }))
    : []

  return (
    <div className="space-y-5 px-6 pb-10 pt-2" data-testid="reports-operations-page">
      <ReportHero
        eyebrow="Operations command"
        title="Where the plant is right now."
        description="Plant manager + planner shared lens. Machine heatmap, stage throughput, schedule adherence, operator productivity, and live blockers."
        accent="cyan"
        chips={[
          { label: `${formatNumber(Number(headline.active_job_cards || 0))} active jobs`, tone: "neutral" },
          { label: `${blockedRows.length} blocked`, tone: blockedRows.length ? "critical" : "ok" },
          { label: `${machines.length} machines tracked`, tone: "neutral" },
        ]}
      />

      <ReportFilterBar>
        <FilterField label="Window">
          <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-sm font-semibold text-slate-700">Last 7 days</span>
        </FilterField>
        <FilterField label="Plant">
          <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-sm font-semibold text-slate-700">{activePlantLabel}</span>
        </FilterField>
      </ReportFilterBar>

      <KpiRail
        items={[
          { label: "Active jobs", value: formatNumber(Number(headline.active_job_cards || 0)), tone: "cyan", detail: "On the route" },
          { label: "Blocked", value: formatNumber(blockedRows.length), tone: blockedRows.length ? "rose" : "emerald" },
          { label: "Adherence", value: adherencePercent === null ? "—" : formatPct(adherencePercent), tone: adherencePercent === null ? "slate" : adherencePercent >= 92 ? "emerald" : "rose", detail: "Stage actual vs plan" },
          { label: "Machine util (top)", value: topMachine ? `${formatNumber(topMachine.total_hours)} h` : "—", tone: "violet", detail: topMachine?.label || "—" },
          { label: "Stages tracked", value: formatNumber(stagePipeline.length), tone: "slate" },
          { label: "Operators", value: formatNumber(operatorRows.length), tone: "amber" },
        ]}
      />

      <Panel
        eyebrow="Machine utilization (7×24)"
        title={topMachine ? `${topMachine.label} · hourly load heatmap` : "Hourly machine load"}
        description="Darker = more concurrent stage-hours. Click into a peak block to see the job cards running in that window."
      >
        {utilLoading ? (
          <NoteCallout tone="neutral">Loading machine utilization…</NoteCallout>
        ) : topMachine ? (
          <CalendarHeatmap rows={7} cols={24} values={heatmapValues} rowLabels={dayLabels} colLabels={hourLabels} unit="h" />
        ) : (
          <NoteCallout tone="neutral">No machine utilization data is available in this window yet.</NoteCallout>
        )}
        {machines.length > 1 ? (
          <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3 text-xs">
            {machines.slice(1).map((m) => (
              <div key={m.key} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-900">{m.label}</span>
                  <span className="text-slate-500">{formatNumber(m.total_hours)} h</span>
                </div>
                <p className="mt-1 text-slate-500">Peak hour load: {formatNumber(m.peak_hour_load)}</p>
              </div>
            ))}
          </div>
        ) : null}
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[1.1fr_1fr]">
        <Panel eyebrow="Stage queue" title="WIP by stage" description="Stages with rising queues need a planner intervention.">
          {stagePipeline.length ? (
            <MiniLadder rows={stagePipeline} formatter={(v) => `${formatNumber(v)} JCs`} />
          ) : (
            <NoteCallout tone="neutral">No stage queue data yet.</NoteCallout>
          )}
        </Panel>
        <Panel eyebrow="Adherence" title="Schedule adherence" description="% of stages completed within the planned cycle.">
          <div className="text-center">
            <p className="text-5xl font-extrabold text-slate-950">{adherencePercent === null ? "—" : formatPct(adherencePercent)}</p>
            <p className="mt-1 text-sm text-slate-500">
              {adherencePercent === null ? "No planned-vs-actual adherence value returned for this window." : "Target ≥ 92%"}
            </p>
          </div>
        </Panel>
      </div>

      <Panel
        eyebrow="Operators"
        title="Operator productivity (window)"
        description={`${formatNumber(Number(operatorSummary.completed_stages || 0))} completed stages · ${formatNumber(Number(operatorSummary.output_qty || 0))} output qty`}
      >
        {operatorRows.length ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="py-2 pr-3">Operator</th>
                <th className="py-2 pr-3">Stage</th>
                <th className="py-2 pr-3 text-right">Cards</th>
                <th className="py-2 pr-3 text-right">Completed</th>
                <th className="py-2 pr-3 text-right">Output</th>
                <th className="py-2 pr-3">On-time</th>
                <th className="py-2 pr-3" />
              </tr>
            </thead>
            <tbody>
              {operatorRows.map((o) => (
                <tr key={o.operator} className="border-b border-slate-100">
                  <td className="py-2 pr-3 font-medium text-slate-900">{o.operator}</td>
                  <td className="py-2 pr-3 text-slate-700">{o.primary_stage}</td>
                  <td className="py-2 pr-3 text-right font-bold">{formatNumber(Number(o.cards || 0))}</td>
                  <td className="py-2 pr-3 text-right">{formatNumber(Number(o.completed_stages || 0))}</td>
                  <td className="py-2 pr-3 text-right">{formatNumber(Number(o.output_qty || 0))}</td>
                  <td className="py-2 pr-3">
                    {o.on_time_percent === null || o.on_time_percent === undefined ? (
                      <span className="text-slate-400">—</span>
                    ) : (
                      <Pill tone={Number(o.on_time_percent) >= 92 ? "ok" : Number(o.on_time_percent) >= 80 ? "warn" : "critical"}>
                        {formatPct(Number(o.on_time_percent))}
                      </Pill>
                    )}
                  </td>
                  <td className="py-2 pr-3"><DrillLink href={`/production/job-cards?operator=${encodeURIComponent(o.operator || "")}`}>Detail</DrillLink></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <NoteCallout tone="neutral">No operator-attributed stage entries were returned for this window.</NoteCallout>
        )}
      </Panel>

      <Panel eyebrow="Live blockers" title={`${blockedRows.length} active blockers`} description="Stages waiting on planner / QC / supervisor.">
        {blockedRows.length ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="py-2 pr-3">Job card</th>
                <th className="py-2 pr-3">Customer</th>
                <th className="py-2 pr-3">Stage</th>
                <th className="py-2 pr-3">Reason</th>
                <th className="py-2 pr-3" />
              </tr>
            </thead>
            <tbody>
              {blockedRows.slice(0, 12).map((row: any, i: number) => (
                <tr key={i} className="border-b border-slate-100">
                  <td className="py-2 pr-3 font-mono text-xs">{row.job_card_no || row.job_card_id || "—"}</td>
                  <td className="py-2 pr-3">{row.customer_name || "—"}</td>
                  <td className="py-2 pr-3">{row.current_stage || row.stage || "—"}</td>
                  <td className="py-2 pr-3 text-rose-700">{row.blocker_reason || row.reason || "Waiting"}</td>
                  <td className="py-2 pr-3"><DrillLink href={`/job-cards/${row.job_card_id || ""}`}>Open</DrillLink></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <NoteCallout tone="ok">Nothing blocked right now. Watch the queue cadence.</NoteCallout>
        )}
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel
          eyebrow="Data-entry lag"
          title="How late is stage-output entry?"
          description="Lag = entered_at − actual_end. Median + p90 across the window; row count past 6h threshold."
        >
          {(lag as any)?.summary?.sample_size > 0 ? (
            <>
              <div className="grid grid-cols-3 gap-2 mb-3">
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Median</div>
                  <div className="text-lg font-bold">{Math.round(Number((lag as any).summary.median_minutes || 0))} min</div>
                </div>
                <div className={`rounded-lg border px-3 py-2 ${Number((lag as any).summary.p90_minutes || 0) > 360 ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-slate-50"}`}>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">p90</div>
                  <div className="text-lg font-bold">{Math.round(Number((lag as any).summary.p90_minutes || 0))} min</div>
                </div>
                <div className={`rounded-lg border px-3 py-2 ${Number((lag as any).summary.late_count || 0) ? "border-rose-200 bg-rose-50" : "border-emerald-200 bg-emerald-50"}`}>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">&gt; 6h late</div>
                  <div className="text-lg font-bold">{(lag as any).summary.late_count} / {(lag as any).summary.sample_size}</div>
                </div>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    <th className="py-2 pr-3">Job card</th>
                    <th className="py-2 pr-3">Stage</th>
                    <th className="py-2 pr-3">Actual end</th>
                    <th className="py-2 pr-3">Entered at</th>
                    <th className="py-2 pr-3 text-right">Lag</th>
                  </tr>
                </thead>
                <tbody>
                  {((lag as any).laggard_rows || []).slice(0, 8).map((r: any, i: number) => (
                    <tr key={i} className="border-b border-slate-100">
                      <td className="py-2 pr-3 font-mono text-xs">{String(r.job_card_id || "").slice(0, 8)}</td>
                      <td className="py-2 pr-3 text-xs">{r.stage_type}</td>
                      <td className="py-2 pr-3 text-xs">{r.actual_end ? new Date(r.actual_end).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                      <td className="py-2 pr-3 text-xs">{r.entered_at ? new Date(r.entered_at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                      <td className={`py-2 pr-3 text-right font-bold ${Number(r.lag_minutes) > 360 ? "text-rose-700" : Number(r.lag_minutes) > 60 ? "text-amber-700" : "text-slate-700"}`}>
                        {Math.round(Number(r.lag_minutes || 0))} min
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <NoteCallout tone="neutral">No stage entries with both actual_end + entered_at yet.</NoteCallout>
          )}
        </Panel>

        <Panel
          eyebrow="Short-close + downtime"
          title="Where the planned qty went"
          description="Job-card short-close events + machine downtime events in this window. Drives the OEE Availability denominator."
        >
          <div className="space-y-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">Short-closes ({Array.isArray(shortCloses) ? shortCloses.length : 0})</p>
              {Array.isArray(shortCloses) && shortCloses.length > 0 ? (
                <table className="w-full text-xs">
                  <thead><tr className="text-[10px] font-bold uppercase text-slate-500 border-b border-slate-200">
                    <th className="text-left py-1">Job card</th><th className="text-right py-1">Gap</th><th className="text-left py-1 pl-2">Reason</th><th className="text-left py-1 pl-2">Decision</th>
                  </tr></thead>
                  <tbody>
                    {shortCloses.slice(0, 8).map((s: any) => (
                      <tr key={s.id} className="border-b border-slate-100">
                        <td className="font-mono">{String(s.job_card_id || "").slice(0, 8)}</td>
                        <td className="text-right font-bold text-rose-700">{Math.round(Number(s.gap_qty || 0))}</td>
                        <td className="pl-2 font-mono">{s.reason_code}</td>
                        <td className="pl-2"><Pill tone={s.decision === "CARRY_FORWARD" ? "ok" : s.decision === "SHORT_CLOSE_SO" ? "warn" : "neutral"}>{s.decision?.replace("_", " ")}</Pill></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <span className="text-[11px] text-slate-500">No short-close events.</span>
              )}
            </div>

            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">Downtime ({Array.isArray(downtimeRows) ? downtimeRows.length : 0})</p>
              {Array.isArray(downtimeRows) && downtimeRows.length > 0 ? (
                <table className="w-full text-xs">
                  <thead><tr className="text-[10px] font-bold uppercase text-slate-500 border-b border-slate-200">
                    <th className="text-left py-1">Machine</th><th className="text-left py-1 pl-2">Reason</th><th className="text-right py-1">Minutes</th><th className="text-left py-1 pl-2">Type</th>
                  </tr></thead>
                  <tbody>
                    {downtimeRows.slice(0, 8).map((d: any) => (
                      <tr key={d.id} className="border-b border-slate-100">
                        <td className="font-mono">{d.machine_code || String(d.machine_id || "").slice(0, 8)}</td>
                        <td className="pl-2 font-mono">{d.reason_code}</td>
                        <td className="text-right font-bold">{Math.round(Number(d.duration_minutes || 0))} m</td>
                        <td className="pl-2"><Pill tone={d.is_planned ? "ok" : "warn"}>{d.is_planned ? "PLANNED" : "UNPLANNED"}</Pill></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <span className="text-[11px] text-slate-500">No downtime logged.</span>
              )}
            </div>

            <div className="pt-2 border-t border-slate-100">
              <DrillLink href="/operations/control">Open Operations Control →</DrillLink>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  )
}
