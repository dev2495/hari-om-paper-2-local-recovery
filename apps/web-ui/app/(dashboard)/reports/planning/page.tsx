"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { CalendarCheck2, CheckCircle2, Clock3, Download, Gauge, Undo2, ClipboardCheck } from "lucide-react"
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

import { PageHeader } from "@/components/workspace/page-header"
import { RoleGate } from "@/components/workspace/role-gate"
import { ErrorState, LoadingState } from "@/components/workspace/query-state"
import { MATCH_TONE, RESULT_META, SLOT_HEADERS, STAGE_LABEL, TONE, cardHref, downloadWorkbook, fmtClock, fmtDateTime, fmtDay, fmtNum, fmtPct, machineMap, machineName, shiftLabel, slotRow, stageLabel, unitLabel, type Tone } from "@/components/planning/overview/lib"
import { Section, Tile, ToneChip } from "@/components/planning/overview/ui"
import type { PlanningReport, PlanningReportCard, SlotResult } from "@/components/planning/overview/types"
import { productionApi } from "@/lib/api"
import { cn } from "@/lib/utils"

/**
 * Planning performance (client 2026-10-26: "reports on these in Reports"). How well the plan held
 * for a period: slots done in their shift, stages finished on time, runs before planning, missed
 * slots and machine load.
 */
const STAGES = [["", "All stages"], ["WINDER", "Winding"], ["OVEN", "Oven"], ["PROCESS", "Process"], ["SLITTING", "Slitting"]] as const
const PERIODS = [{ label: "7 days", days: 7 }, { label: "30 days", days: 30 }, { label: "90 days", days: 90 }]
const TREND_KEYS: SlotResult[] = ["DONE", "PARTLY", "MOVED", "NOT_RUN", "FLOOR_PLACED"]
const CARD_STATUS: Record<PlanningReportCard["status"], { label: string; tone: Tone }> = {
  ON_TIME: { label: "Finished on time", tone: "emerald" },
  LATE: { label: "Finished late", tone: "rose" },
  OPEN: { label: "Still open", tone: "blue" },
  OPEN_LATE: { label: "Open, past planned finish", tone: "amber" },
}

const iso = (date: Date) => date.toLocaleDateString("en-CA")
const daysAgo = (days: number) => { const d = new Date(); d.setDate(d.getDate() - days); return iso(d) }

function ResultCells({ row }: { row: { done: number; partly: number; moved: number; not_run: number; floor_placed: number; adherence_pct: number | null } }) {
  return (
    <>
      <td className="num">{fmtNum(row.done)}</td>
      <td className="num">{fmtNum(row.partly)}</td>
      <td className="num">{fmtNum(row.moved)}</td>
      <td className={cn("num", row.not_run ? "font-semibold text-signal-rose-ink" : "")}>{fmtNum(row.not_run)}</td>
      <td className="num">{fmtNum(row.floor_placed)}</td>
      <td className={cn("num font-semibold", row.adherence_pct == null ? "text-muted-foreground" : row.adherence_pct >= 85 ? "text-signal-emerald-ink" : row.adherence_pct >= 60 ? "text-signal-amber-ink" : "text-signal-rose-ink")}>{fmtPct(row.adherence_pct, 1)}</td>
    </>
  )
}

function TrendTooltip({ active, payload, label }: { active?: boolean; payload?: { dataKey: string; value: number; name: string }[]; label?: string }) {
  if (!active || !payload?.length) return null
  const rows = payload.filter((row) => Number(row.value) > 0)
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-[12px] shadow-pop">
      <p className="font-semibold text-foreground">{fmtDay(label)}</p>
      <ul className="mt-1 space-y-0.5">
        {rows.map((row) => (
          <li key={row.dataKey} className="flex items-center justify-between gap-4 text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className={cn("inline-block h-2 w-2 rounded-sm", TONE[RESULT_META[row.dataKey as SlotResult]?.tone || "neutral"].bar)} aria-hidden="true" />
              {row.name}
            </span>
            <span className="tabular-nums font-semibold text-foreground">{fmtNum(row.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function PlanningReportPage() {
  return (
    <RoleGate allow={["Owner", "Admin", "PlantManager", "Planner", "Production"]}>
      <PlanningReport />
    </RoleGate>
  )
}

function PlanningReport() {
  const [from, setFrom] = useState(daysAgo(30))
  const [to, setTo] = useState(iso(new Date()))
  const [stage, setStage] = useState("")
  const query = useQuery({
    queryKey: ["planning-report", from, to, stage],
    queryFn: async () => (await productionApi.getPlanningReport({ date_from: from, date_to: to, stages: stage || undefined })).data as PlanningReport,
  })
  const data = query.data
  const summary = data?.summary
  const machines = useMemo(() => machineMap(data?.machines), [data?.machines])
  const trend = useMemo(() => (data?.trend || []).map((row) => ({ date: row.date, DONE: row.done, PARTLY: row.partly, MOVED: row.moved, NOT_RUN: row.not_run, FLOOR_PLACED: row.floor_placed })), [data?.trend])
  const lateCards = useMemo(() => (data?.cards || []).filter((row) => row.status === "LATE" || row.status === "OPEN_LATE").sort((a, b) => Number(b.late_days || 0) - Number(a.late_days || 0) || String(a.planned_finish || "").localeCompare(String(b.planned_finish || ""))), [data?.cards])
  const byMachine = useMemo(() => (data?.by_machine || []).slice().sort((a, b) => stageLabel(a.stage).localeCompare(stageLabel(b.stage)) || machineName(machines, a.machine_id).localeCompare(machineName(machines, b.machine_id))), [data?.by_machine, machines])

  const exportExcel = () =>
    downloadWorkbook((workbook) => {
      if (!data) return
      const summarySheet = workbook.addWorksheet("Summary")
      summarySheet.addRow(["Period", `${from} to ${to}`])
      summarySheet.addRow(["Stages", stage ? STAGE_LABEL[stage as keyof typeof STAGE_LABEL] : "All"])
      for (const [key, value] of Object.entries(data.summary || {})) summarySheet.addRow([key.replace(/_/g, " "), value ?? ""])
      const resultHeaders = ["Slots", "Cards", "Planned pcs", "Done in slot", "Partly", "Moved", "Not run", "Logged before planning", "Done in slot %"]
      const stageSheet = workbook.addWorksheet("By stage")
      stageSheet.addRow(["Stage", ...resultHeaders, "Planned qty", "Made in slot", "Made elsewhere"])
      for (const row of data.by_stage || []) stageSheet.addRow([stageLabel(row.stage), row.slots, row.cards, row.planned_pcs, row.done, row.partly, row.moved, row.not_run, row.floor_placed, row.adherence_pct ?? "", row.planned_qty, row.made_in_slot, row.made_elsewhere])
      const machineSheet = workbook.addWorksheet("By machine")
      machineSheet.addRow(["Machine", "Stage", ...resultHeaders, "Avg load %"])
      for (const row of byMachine) machineSheet.addRow([machineName(machines, row.machine_id), stageLabel(row.stage), row.slots, row.cards, row.planned_pcs, row.done, row.partly, row.moved, row.not_run, row.floor_placed, row.adherence_pct ?? "", row.avg_load_pct ?? ""])
      const shiftSheet = workbook.addWorksheet("By shift")
      shiftSheet.addRow(["Shift", ...resultHeaders])
      for (const row of data.by_shift || []) shiftSheet.addRow([shiftLabel(row.shift_code), row.slots, row.cards, row.planned_pcs, row.done, row.partly, row.moved, row.not_run, row.floor_placed, row.adherence_pct ?? ""])
      const trendSheet = workbook.addWorksheet("Per day")
      trendSheet.addRow(["Date", ...resultHeaders])
      for (const row of data.trend || []) trendSheet.addRow([row.date, row.slots, row.cards, row.planned_pcs, row.done, row.partly, row.moved, row.not_run, row.floor_placed, row.adherence_pct ?? ""])
      const cardSheet = workbook.addWorksheet("Cards")
      cardSheet.addRow(["Job card", "Customer", "Stage", "Slots", "Planned finish", "Finished at", "Status", "Late days"])
      for (const row of data.cards || []) cardSheet.addRow([row.job_card_no, row.customer_name || "", stageLabel(row.stage), row.slots, row.planned_finish || "", row.finished_at || "", CARD_STATUS[row.status]?.label || row.status, row.late_days])
      const missedSheet = workbook.addWorksheet("Missed slots")
      missedSheet.addRow(["Job card", "Stage", "Planned date", "Planned shift", "Planned machine", "Requeued at"])
      for (const row of data.missed || []) missedSheet.addRow([row.job_card_no, stageLabel(row.stage), row.planned_date || "", shiftLabel(row.planned_shift), machineName(machines, row.planned_machine_id), row.requeued_at || ""])
      const unplannedSheet = workbook.addWorksheet("Runs before planning")
      unplannedSheet.addRow(["Job card", "Stage", "Date", "Shift", "Machine", "Run", "Made", "Good", "Unit", "Operator"])
      for (const row of data.unplanned_runs || []) unplannedSheet.addRow([row.job_card_no, stageLabel(row.stage), row.date, shiftLabel(row.shift_code), machineName(machines, row.machine_id), row.run, row.made, row.good, unitLabel(row.unit), row.operator || ""])
      const slotSheet = workbook.addWorksheet("Slots")
      slotSheet.addRow(SLOT_HEADERS)
      for (const slot of data.slots || []) slotSheet.addRow(slotRow(slot, machines))
    }, `planning-performance-${from}-to-${to}.xlsx`)

  return (
    <div className="space-y-4" data-testid="planning-report">
      <PageHeader
        badge="Reports"
        title="Planning performance"
        description="How well the plan held: planned slots done in their own shift, stages finished by their planned time, floor runs logged before planning, slots that passed in silence and how loaded the machines were. Planning is only the plan; the job card log is the truth."
        actions={
          <button type="button" className="erp-btn-secondary" onClick={() => void exportExcel()} disabled={!data}>
            <Download className="h-4 w-4" aria-hidden="true" />
            Excel
          </button>
        }
      />

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card px-4 py-3">
        <div className="tube-segment" role="group" aria-label="Period">
          {PERIODS.map((period) => (
            <button key={period.days} type="button" aria-pressed={from === daysAgo(period.days) && to === iso(new Date())} onClick={() => { setFrom(daysAgo(period.days)); setTo(iso(new Date())) }}>
              {period.label}
            </button>
          ))}
        </div>
        <label className="grid gap-1 text-[12px] font-medium text-muted-foreground">
          From
          <input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} className="h-9 rounded-lg border border-input bg-card px-2 text-[13px] text-foreground" />
        </label>
        <label className="grid gap-1 text-[12px] font-medium text-muted-foreground">
          To
          <input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} className="h-9 rounded-lg border border-input bg-card px-2 text-[13px] text-foreground" />
        </label>
        <div className="tube-segment" role="group" aria-label="Stage">
          {STAGES.map(([value, label]) => (
            <button key={value || "all"} type="button" aria-pressed={stage === value} onClick={() => setStage(value)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {query.isLoading ? (
        <LoadingState label="Reading the plan against the floor log…" />
      ) : query.isError || !data || !summary ? (
        <ErrorState title="Planning performance could not load" message="Refresh to retry." onRetry={() => void query.refetch()} />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <Tile label="Done in slot" value={fmtPct(summary.adherence_pct, 1)} hint={`${fmtNum(summary.done)} done · ${fmtNum(summary.partly)} partly · ${fmtNum(summary.moved)} moved · ${fmtNum(summary.not_run)} not run of ${fmtNum(summary.slots)} slots`} Icon={CheckCircle2} tone={summary.adherence_pct == null ? "neutral" : summary.adherence_pct >= 85 ? "emerald" : summary.adherence_pct >= 60 ? "amber" : "rose"} />
            <Tile label="Stages finished on time" value={fmtPct(summary.on_time_pct, 1)} hint={`${fmtNum(summary.finished_on_time)} of ${fmtNum(summary.stages_finished)} card stages finished by their planned slot`} Icon={Clock3} tone={summary.on_time_pct == null ? "neutral" : summary.on_time_pct >= 85 ? "emerald" : summary.on_time_pct >= 60 ? "amber" : "rose"} />
            <Tile label="Runs before planning" value={fmtPct(summary.unplanned_share_pct, 1)} hint={`${fmtNum(summary.unplanned_runs)} of ${fmtNum(summary.runs)} floor runs had no slot when they were logged`} Icon={ClipboardCheck} tone={summary.unplanned_share_pct ? "teal" : "neutral"} />
            <Tile label="Missed slots" value={fmtNum(summary.missed_slots)} hint="Slots that passed in silence and went back to the queue" Icon={Undo2} tone={summary.missed_slots ? "rose" : "neutral"} />
            <Tile label="Average machine load" value={fmtPct(summary.avg_load_pct, 1)} hint="Planned load against capacity, over every planned machine-shift" Icon={Gauge} tone={summary.avg_load_pct == null ? "neutral" : summary.avg_load_pct > 100 ? "rose" : summary.avg_load_pct >= 85 ? "amber" : "emerald"} />
          </div>

          <Section title="Per day" subtitle="Planned slots of each day by what happened to them">
            {trend.length ? (
              <div className="h-64" aria-label="Slots per day by result">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={trend} margin={{ left: 0, right: 8, top: 8, bottom: 0 }} barCategoryGap={trend.length > 30 ? 1 : 6}>
                    <CartesianGrid vertical={false} stroke="hsl(var(--chart-grid))" />
                    <XAxis dataKey="date" tickFormatter={(value) => fmtDay(String(value))} tick={{ fontSize: 11 }} interval="preserveStartEnd" minTickGap={24} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={32} />
                    <Tooltip cursor={{ fill: "hsl(var(--foreground) / .04)" }} content={<TrendTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 11.5 }} iconSize={10} />
                    {TREND_KEYS.map((key, index, all) => (
                      <Bar key={key} dataKey={key} name={RESULT_META[key].short === "Floor placed" ? "Logged before planning" : RESULT_META[key].short} stackId="slots" fill={TONE[RESULT_META[key].tone].chart} stroke="hsl(var(--card))" strokeWidth={2} radius={index === all.length - 1 ? [4, 4, 0, 0] : 0} maxBarSize={28} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No planned slots in this period.</p>
            )}
          </Section>

          <div className="grid gap-4 xl:grid-cols-2">
            <Section title="By stage" subtitle="Slots of each stage and how many were done in their slot">
              <div className="-mx-4 -mb-4 overflow-x-auto">
                <table className="tube-grid w-full">
                  <thead>
                    <tr>
                      <th>Stage</th>
                      <th className="num">Slots</th>
                      <th className="num">Done</th>
                      <th className="num">Partly</th>
                      <th className="num">Moved</th>
                      <th className="num">Not run</th>
                      <th className="num">Before plan</th>
                      <th className="num">Done in slot</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.by_stage || []).map((row) => (
                      <tr key={row.stage}>
                        <td>
                          <span className="font-semibold">{stageLabel(row.stage)}</span>
                          <span className="block whitespace-nowrap text-[11px] text-muted-foreground">{fmtNum(row.cards)} cards</span>
                          <span className="block whitespace-nowrap text-[11px] text-muted-foreground">{fmtNum(row.made_in_slot, 1)} of {fmtNum(row.planned_qty, 1)} in slot</span>
                        </td>
                        <td className="num">{fmtNum(row.slots)}</td>
                        <ResultCells row={row} />
                      </tr>
                    ))}
                    {!data.by_stage?.length ? <tr><td colSpan={8} className="text-center text-muted-foreground">No stages in this period.</td></tr> : null}
                  </tbody>
                </table>
              </div>
            </Section>
            <Section title="By shift" subtitle="Shift A 08:00–20:00 · Shift B 20:00–08:00">
              <div className="-mx-4 -mb-4 overflow-x-auto">
                <table className="tube-grid w-full">
                  <thead>
                    <tr>
                      <th>Shift</th>
                      <th className="num">Slots</th>
                      <th className="num">Done</th>
                      <th className="num">Partly</th>
                      <th className="num">Moved</th>
                      <th className="num">Not run</th>
                      <th className="num">Before plan</th>
                      <th className="num">Done in slot</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.by_shift || []).map((row) => (
                      <tr key={row.shift_code}>
                        <td>
                          <span className="font-semibold">{shiftLabel(row.shift_code)}</span>
                          <span className="block text-[11px] text-muted-foreground">{fmtNum(row.cards)} cards · {fmtNum(row.planned_pcs)} pcs planned</span>
                        </td>
                        <td className="num">{fmtNum(row.slots)}</td>
                        <ResultCells row={row} />
                      </tr>
                    ))}
                    {!data.by_shift?.length ? <tr><td colSpan={8} className="text-center text-muted-foreground">No shifts in this period.</td></tr> : null}
                  </tbody>
                </table>
              </div>
            </Section>
          </div>

          <Section title="By machine" subtitle="Slots per machine, how many were done in their slot, and the average planned load">
            <div className="-mx-4 -mb-4 overflow-x-auto">
              <table className="tube-grid w-full min-w-[760px]">
                <thead>
                  <tr>
                    <th>Machine</th>
                    <th>Stage</th>
                    <th className="num">Slots</th>
                    <th className="num">Done</th>
                    <th className="num">Partly</th>
                    <th className="num">Moved</th>
                    <th className="num">Not run</th>
                    <th className="num">Before plan</th>
                    <th className="num">Done in slot</th>
                    <th className="num">Avg load</th>
                  </tr>
                </thead>
                <tbody>
                  {byMachine.map((row) => (
                    <tr key={row.machine_id}>
                      <td className="font-semibold">{machineName(machines, row.machine_id)}</td>
                      <td>{stageLabel(row.stage)}</td>
                      <td className="num">{fmtNum(row.slots)}</td>
                      <ResultCells row={row} />
                      <td className={cn("num", row.avg_load_pct != null && row.avg_load_pct > 100 ? "font-semibold text-signal-rose-ink" : "")}>{fmtPct(row.avg_load_pct, 1)}</td>
                    </tr>
                  ))}
                  {!byMachine.length ? <tr><td colSpan={10} className="text-center text-muted-foreground">No machine had a planned slot in this period.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </Section>

          <Section title="Card stages finished late" subtitle={`${fmtNum(lateCards.length)} card stage${lateCards.length === 1 ? "" : "s"} finished after the planned slot, or still open past it`}>
            {lateCards.length ? (
              <div className="-mx-4 -mb-4 overflow-x-auto">
                <table className="tube-grid w-full min-w-[720px]">
                  <thead>
                    <tr>
                      <th>Job card</th>
                      <th>Stage</th>
                      <th>Planned finish</th>
                      <th>Finished</th>
                      <th>Status</th>
                      <th className="num">Late by</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lateCards.slice(0, 100).map((row) => {
                      const status = CARD_STATUS[row.status] || CARD_STATUS.OPEN
                      return (
                        <tr key={`${row.job_card_id}:${row.stage}`}>
                          <td>
                            <Link href={cardHref(row.job_card_id)} className="font-semibold text-primary">{row.job_card_no}</Link>
                            <span className="block text-[11.5px] text-muted-foreground">{row.customer_name || ""}</span>
                          </td>
                          <td>{stageLabel(row.stage)}<span className="block text-[11.5px] text-muted-foreground">{fmtNum(row.slots)} slot{row.slots === 1 ? "" : "s"}</span></td>
                          <td className="whitespace-nowrap tabular-nums">{fmtDateTime(row.planned_finish)}</td>
                          <td className="whitespace-nowrap tabular-nums">{row.finished_at ? fmtDateTime(row.finished_at) : <span className="text-muted-foreground">not yet</span>}</td>
                          <td><ToneChip tone={status.tone}>{status.label}</ToneChip></td>
                          <td className="num">{row.late_days ? `${fmtNum(row.late_days)} day${row.late_days === 1 ? "" : "s"}` : "—"}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="flex items-center gap-2 text-sm text-muted-foreground"><CalendarCheck2 className="h-4 w-4" aria-hidden="true" />Every planned card stage in this period finished on time.</p>
            )}
          </Section>

          <div className="grid gap-4 xl:grid-cols-2">
            <Section title="Missed slots" subtitle="Slots that passed with no floor entry and went back to the queue">
              {data.missed?.length ? (
                <div className="-mx-4 -mb-4 overflow-x-auto">
                  <table className="tube-grid w-full">
                    <thead><tr><th>Job card</th><th>Stage</th><th>Planned</th><th>Machine</th><th>Back in queue</th></tr></thead>
                    <tbody>
                      {data.missed.map((row, index) => (
                        <tr key={`${row.job_card_id}:${index}`}>
                          <td><Link href={cardHref(row.job_card_id)} className="font-semibold text-primary">{row.job_card_no}</Link></td>
                          <td>{stageLabel(row.stage)}</td>
                          <td className="whitespace-nowrap">{fmtDay(row.planned_date)} · {shiftLabel(row.planned_shift)}</td>
                          <td>{machineName(machines, row.planned_machine_id)}</td>
                          <td className="whitespace-nowrap">{row.requeued_at ? fmtDateTime(row.requeued_at) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="flex items-center gap-2 text-sm text-muted-foreground"><CalendarCheck2 className="h-4 w-4" aria-hidden="true" />Every planned slot in this period had a floor entry.</p>
              )}
            </Section>
            <Section title="Runs before planning" subtitle="Floor runs logged while the stage had no slot; the planner placed the slot from the log afterwards">
              {data.unplanned_runs?.length ? (
                <div className="-mx-4 -mb-4 overflow-x-auto">
                  <table className="tube-grid w-full">
                    <thead><tr><th>Job card</th><th>Stage · run</th><th>Ran</th><th className="num">Good</th></tr></thead>
                    <tbody>
                      {data.unplanned_runs.slice(0, 100).map((row) => (
                        <tr key={row.key}>
                          <td><Link href={cardHref(row.job_card_id)} className="font-semibold text-primary">{row.job_card_no}</Link></td>
                          <td>{stageLabel(row.stage)}<span className="block text-[11.5px] text-muted-foreground">{row.run}{row.operator ? ` · ${row.operator}` : ""}</span></td>
                          <td className="whitespace-nowrap">{fmtDay(row.date)} · {shiftLabel(row.shift_code)}<span className="block text-[11.5px] text-muted-foreground">{machineName(machines, row.machine_id)}{fmtClock(row.start) ? ` · ${fmtClock(row.start)}–${fmtClock(row.end) || "?"}` : ""}</span></td>
                          <td className="num">
                            {fmtNum(row.good, 1)} <span className="text-[11px] text-muted-foreground">{unitLabel(row.unit)}</span>
                            <span className="block"><ToneChip tone={MATCH_TONE[row.match] || "teal"} className="!text-[10.5px]">{row.match_label}</ToneChip></span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {data.unplanned_runs.length > 100 ? <p className="px-4 py-2 text-[12px] text-muted-foreground">First 100 of {fmtNum(data.unplanned_runs.length)} shown; Excel has every run.</p> : null}
                </div>
              ) : (
                <p className="flex items-center gap-2 text-sm text-muted-foreground"><CalendarCheck2 className="h-4 w-4" aria-hidden="true" />Every floor run in this period had a planned slot.</p>
              )}
            </Section>
          </div>
        </>
      )}
    </div>
  )
}
