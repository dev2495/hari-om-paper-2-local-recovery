"use client"

import Link from "next/link"
import { useMemo, useState, type ReactNode } from "react"
import { useQuery } from "@tanstack/react-query"
import { CalendarCheck2, Download } from "lucide-react"
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

import { PageHeader } from "@/components/workspace/page-header"
import { RoleGate } from "@/components/workspace/role-gate"
import { ErrorState, LoadingState } from "@/components/workspace/query-state"
import { useMachines } from "@/hooks/use-production"
import { productionApi } from "@/lib/api"
import { cn } from "@/lib/utils"

/**
 * Plan vs actual (client 2026-10-25: "planned job card and actual — compare the entry from shift data
 * to planning data, to check if it actually ran at that planned time or not").
 */
const STAGES = [["", "All stages"], ["WINDER", "Winding"], ["OVEN", "Oven"], ["PROCESS", "Process"], ["SLITTING", "Slitting"]] as const
const STAGE_LABEL: Record<string, string> = { WINDER: "Winding", OVEN: "Oven", PROCESS: "Process", SLITTING: "Slitting" }
const STATUS: Record<string, { label: string; chip: string; color: string }> = {
  ON_PLAN: { label: "As planned", chip: "border-signal-emerald-line bg-signal-emerald-soft text-signal-emerald-ink", color: "hsl(var(--signal-emerald-ink))" },
  OFF_PLAN: { label: "Different from plan", chip: "border-signal-amber-line bg-signal-amber-soft text-signal-amber-ink", color: "hsl(var(--signal-amber-ink))" },
  UNPLANNED: { label: "Run before planning", chip: "border-signal-orange-line bg-signal-orange-soft text-signal-orange-ink", color: "hsl(var(--signal-orange-ink))" },
  MISSED: { label: "Planned, not run", chip: "border-signal-rose-line bg-signal-rose-soft text-signal-rose-ink", color: "hsl(var(--signal-rose-ink))" },
}
const DEVIATION: Record<string, string> = { LATE: "ran later", EARLY: "ran earlier", SHIFT: "other shift", MACHINE: "other machine", TIME: "card time outside the planned shift" }
const PERIODS = [{ label: "7 days", days: 7 }, { label: "30 days", days: 30 }, { label: "90 days", days: 90 }]
const PAGE = 50

const iso = (date: Date) => date.toLocaleDateString("en-CA")
const daysAgo = (days: number) => { const d = new Date(); d.setDate(d.getDate() - days); return iso(d) }
const shift = (value?: string | null) => (value ? String(value).replace("SHIFT_", "Shift ") : "—")
const day = (value?: string | null) => (value ? new Date(`${String(value).slice(0, 10)}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "—")
const clock = (value?: string | null) => (value && String(value).includes("T") ? String(value).slice(11, 16) : "")
const pct = (value?: number | null) => (value == null ? "—" : `${Number(value).toFixed(1)}%`)
const num = (value?: number | null) => Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })

function Tile({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <p className="text-[12px] font-medium text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-[22px] font-semibold tabular-nums leading-tight", tone)}>{value}</p>
      {hint ? <p className="mt-0.5 text-[12px] text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

function Section({ title, subtitle, children, action }: { title: string; subtitle?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div><h2 className="font-semibold">{title}</h2>{subtitle ? <p className="text-[12.5px] text-muted-foreground">{subtitle}</p> : null}</div>
        {action}
      </header>
      <div className="p-4">{children}</div>
    </section>
  )
}

function Chip({ status }: { status: string }) {
  const meta = STATUS[status] || STATUS.OFF_PLAN
  return <span className={cn("inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[11.5px] font-semibold", meta.chip)}>{meta.label}</span>
}

export default function PlanVsActualPage() {
  return (
    <RoleGate allow={["Owner", "Admin", "PlantManager", "Planner", "Production"]}>
      <PlanVsActual />
    </RoleGate>
  )
}

function PlanVsActual() {
  const [from, setFrom] = useState(daysAgo(30))
  const [to, setTo] = useState(iso(new Date()))
  const [stage, setStage] = useState("")
  const [status, setStatus] = useState("")
  const [page, setPage] = useState(0)
  const machinesQuery = useMachines()
  const machineName = useMemo(() => {
    const rows: any[] = Array.isArray(machinesQuery.data) ? machinesQuery.data : []
    const map = new Map(rows.map((row) => [String(row.id), String(row.name || row.code || "")]))
    return (id?: string | null) => (id ? map.get(String(id)) || String(id).slice(0, 8) : "—")
  }, [machinesQuery.data])
  const query = useQuery({
    queryKey: ["plan-vs-actual", from, to, stage],
    queryFn: async () => (await productionApi.getPlanVsActual({ date_from: from, date_to: to, stage: stage || undefined })).data,
  })
  const data: any = query.data || {}
  const summary = data.summary || {}
  const rows: any[] = useMemo(() => (Array.isArray(data.rows) ? data.rows : []).filter((row: any) => !status || row.status === status), [data.rows, status])
  const missed: any[] = Array.isArray(data.missed) ? data.missed : []
  const chart = (Array.isArray(data.by_stage) ? data.by_stage : []).map((row: any) => ({ stage: STAGE_LABEL[row.stage] || row.stage, ON_PLAN: row.on_plan, OFF_PLAN: row.off_plan, UNPLANNED: row.unplanned, MISSED: row.missed }))
  const shown = rows.slice(page * PAGE, page * PAGE + PAGE)

  const exportExcel = async () => {
    const ExcelJS = await import("exceljs")
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet("Plan vs actual")
    sheet.addRow(["Job card", "Customer", "Stage", "Run", "Ran on", "Ran shift", "Ran machine", "Card start", "Card end", "Planned date", "Planned shift", "Planned machine", "Result", "Why", "Produced", "Accepted", "Unit", "Operator"])
    for (const row of rows) {
      sheet.addRow([row.job_card_no, row.customer || "", STAGE_LABEL[row.stage] || row.stage, row.run, row.actual_date, shift(row.actual_shift), machineName(row.machine_id), row.card_start || "", row.card_end || "", row.planned_date || "", shift(row.planned_shift), row.planned_machine_id ? machineName(row.planned_machine_id) : "", STATUS[row.status]?.label || row.status, row.status === "UNPLANNED" ? row.reason || "" : (row.deviations || []).map((code: string) => DEVIATION[code] || code).join(", "), row.produced, row.accepted, row.unit, row.operator || ""])
    }
    const missedSheet = workbook.addWorksheet("Missed slots")
    missedSheet.addRow(["Job card", "Customer", "Stage", "Planned date", "Planned shift", "Planned machine", "Requeued at"])
    for (const row of missed) missedSheet.addRow([row.job_card_no, row.customer || "", STAGE_LABEL[row.stage] || row.stage, row.planned_date, shift(row.planned_shift), machineName(row.planned_machine_id), row.requeued_at || ""])
    const buffer = await workbook.xlsx.writeBuffer()
    const link = document.createElement("a")
    link.href = URL.createObjectURL(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }))
    link.download = `plan-vs-actual-${from}-to-${to}.xlsx`
    link.click()
    URL.revokeObjectURL(link.href)
  }

  return (
    <div className="space-y-4" data-testid="plan-vs-actual">
      <PageHeader
        badge="Reports"
        title="Plan vs actual"
        description="Every floor run against the slot the planner gave it: same day, same shift, same machine, and — where the card times are written — inside the planned shift. Runs before planning and planned slots that were missed are listed too."
        actions={<button type="button" className="erp-btn-secondary" onClick={() => void exportExcel()} disabled={!rows.length}><Download className="h-4 w-4" />Excel</button>}
      />

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card px-4 py-3">
        <div className="tube-segment" role="group" aria-label="Period">
          {PERIODS.map((period) => (
            <button key={period.days} type="button" aria-pressed={from === daysAgo(period.days) && to === iso(new Date())} onClick={() => { setFrom(daysAgo(period.days)); setTo(iso(new Date())); setPage(0) }}>{period.label}</button>
          ))}
        </div>
        <label className="grid gap-1 text-[12px] font-medium text-muted-foreground">From<input type="date" value={from} max={to} onChange={(event) => { setFrom(event.target.value); setPage(0) }} className="h-9 rounded-lg border border-input bg-card px-2 text-[13px] text-foreground" /></label>
        <label className="grid gap-1 text-[12px] font-medium text-muted-foreground">To<input type="date" value={to} min={from} onChange={(event) => { setTo(event.target.value); setPage(0) }} className="h-9 rounded-lg border border-input bg-card px-2 text-[13px] text-foreground" /></label>
        <div className="tube-segment" role="group" aria-label="Stage">
          {STAGES.map(([value, label]) => <button key={value || "all"} type="button" aria-pressed={stage === value} onClick={() => { setStage(value); setPage(0) }}>{label}</button>)}
        </div>
      </div>

      {query.isLoading ? <LoadingState label="Comparing runs with the plan…" /> : query.isError ? <ErrorState title="Plan vs actual could not load" message="Refresh to retry." onRetry={() => { void query.refetch() }} /> : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <Tile label="Runs on the floor" value={num(summary.runs)} hint={`${num(summary.time_written)} with card times`} />
            <Tile label="As planned" value={pct(summary.adherence_pct)} hint={`${num(summary.on_plan)} runs on the planned day, shift and machine`} tone={summary.adherence_pct == null ? "" : summary.adherence_pct >= 90 ? "text-signal-emerald-ink" : "text-signal-amber-ink"} />
            <Tile label="Different from plan" value={num(summary.off_plan)} hint={`${num(summary.late)} later · ${num(summary.early)} earlier · ${num(summary.other_shift)} other shift · ${num(summary.other_machine)} other machine · ${num(summary.outside_slot_time)} outside shift time`} tone={summary.off_plan ? "text-signal-amber-ink" : ""} />
            <Tile label="Run before planning" value={num(summary.unplanned)} hint="Entered before the planner placed the stage" tone={summary.unplanned ? "text-signal-orange-ink" : ""} />
            <Tile label="Planned, not run" value={num(summary.missed_slots)} hint="Slot passed with no entry; card went back to the queue" tone={summary.missed_slots ? "text-signal-rose-ink" : ""} />
          </div>

          <Section title="By stage" subtitle="How many runs of each stage kept to the plan">
            {chart.length ? (
              <div className="h-56" aria-label="Runs by stage and result">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chart} layout="vertical" margin={{ left: 8, right: 16 }} barCategoryGap={10}>
                    <CartesianGrid horizontal={false} stroke="hsl(var(--chart-grid))" />
                    <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="stage" width={72} tick={{ fontSize: 12 }} />
                    <Tooltip cursor={{ fill: "hsl(var(--foreground) / .04)" }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    {(["ON_PLAN", "OFF_PLAN", "UNPLANNED", "MISSED"] as const).map((key, index, all) => (
                      <Bar key={key} dataKey={key} name={STATUS[key].label} stackId="runs" fill={STATUS[key].color} stroke="hsl(var(--card))" strokeWidth={2} radius={index === all.length - 1 ? [0, 4, 4, 0] : 0} maxBarSize={22} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : <p className="text-sm text-muted-foreground">No floor runs in this period.</p>}
          </Section>

          <Section
            title="Runs"
            subtitle={`${num(rows.length)} run${rows.length === 1 ? "" : "s"} · each one against its planned slot`}
            action={
              <div className="tube-segment" role="group" aria-label="Result">
                {[["", "All"], ["ON_PLAN", "As planned"], ["OFF_PLAN", "Different"], ["UNPLANNED", "Before planning"]].map(([value, label]) => (
                  <button key={value || "all"} type="button" aria-pressed={status === value} onClick={() => { setStatus(value); setPage(0) }}>{label}</button>
                ))}
              </div>
            }
          >
            {shown.length ? (
              <div className="-mx-4 -mb-4 overflow-x-auto">
                <table className="tube-grid w-full min-w-[900px]">
                  <thead><tr><th>Job card</th><th>Stage · run</th><th>Ran</th><th>Planned</th><th>Result</th><th className="num">Good</th></tr></thead>
                  <tbody>
                    {shown.map((row: any, index: number) => (
                      <tr key={`${row.job_card_id}:${row.stage}:${row.run}:${index}`}>
                        <td><Link href={`/production/job-cards/${row.job_card_id}`} className="font-semibold text-primary">{row.job_card_no || "—"}</Link><span className="block text-[11.5px] text-muted-foreground">{row.customer || ""}</span></td>
                        <td>{STAGE_LABEL[row.stage] || row.stage}<span className="block text-[11.5px] text-muted-foreground">{row.run}{row.operator ? ` · ${row.operator}` : ""}</span></td>
                        <td className="whitespace-nowrap">{day(row.actual_date)} · {shift(row.actual_shift)}<span className="block text-[11.5px] text-muted-foreground">{machineName(row.machine_id)}{clock(row.card_start) ? ` · ${clock(row.card_start)}–${clock(row.card_end) || "?"}` : ""}</span></td>
                        <td className="whitespace-nowrap">{row.planned_date ? <>{day(row.planned_date)} · {shift(row.planned_shift)}<span className="block text-[11.5px] text-muted-foreground">{machineName(row.planned_machine_id)}</span></> : <span className="text-muted-foreground">Not planned</span>}</td>
                        <td><Chip status={row.status} /><span className="mt-0.5 block max-w-[260px] text-[11.5px] text-muted-foreground">{row.status === "UNPLANNED" ? row.reason : (row.deviations || []).map((code: string) => code === "LATE" || code === "EARLY" ? `${DEVIATION[code]} by ${Math.abs(row.days_off)} day${Math.abs(row.days_off) === 1 ? "" : "s"}` : DEVIATION[code] || code).join(" · ")}</span></td>
                        <td className="num">{num(row.accepted)} <span className="text-[11px] text-muted-foreground">{row.unit}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {rows.length > PAGE ? (
                  <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-2 text-[12.5px]">
                    <span className="text-muted-foreground">{page * PAGE + 1}–{Math.min(rows.length, page * PAGE + PAGE)} of {rows.length}</span>
                    <button type="button" className="erp-btn-secondary !h-8" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>Previous</button>
                    <button type="button" className="erp-btn-secondary !h-8" disabled={(page + 1) * PAGE >= rows.length} onClick={() => setPage((value) => value + 1)}>Next</button>
                  </div>
                ) : null}
              </div>
            ) : <p className="text-sm text-muted-foreground">No runs match.</p>}
          </Section>

          <div className="grid gap-4 xl:grid-cols-2">
            <Section title="Planned, not run" subtitle="Slots that passed with no floor entry (the card went back to the queue after 36 hours)">
              {missed.length ? (
                <div className="-mx-4 -mb-4 overflow-x-auto">
                  <table className="tube-grid w-full"><thead><tr><th>Job card</th><th>Stage</th><th>Planned</th><th>Machine</th></tr></thead>
                    <tbody>{missed.map((row: any, index: number) => <tr key={`${row.job_card_id}:${index}`}><td><Link href={`/production/job-cards/${row.job_card_id}`} className="font-semibold text-primary">{row.job_card_no}</Link></td><td>{STAGE_LABEL[row.stage] || row.stage}</td><td>{day(row.planned_date)} · {shift(row.planned_shift)}</td><td>{machineName(row.planned_machine_id)}</td></tr>)}</tbody>
                  </table>
                </div>
              ) : <p className="flex items-center gap-2 text-sm text-muted-foreground"><CalendarCheck2 className="h-4 w-4" />Every planned slot in this period had a floor entry.</p>}
            </Section>
            <Section title="By machine" subtitle="Runs and how many kept to the plan">
              <div className="-mx-4 -mb-4 overflow-x-auto">
                <table className="tube-grid w-full"><thead><tr><th>Machine</th><th className="num">Runs</th><th className="num">As planned</th><th className="num">Different</th><th className="num">Before planning</th><th className="num">On plan</th></tr></thead>
                  <tbody>{(data.by_machine || []).map((row: any) => <tr key={row.machine_id}><td>{machineName(row.machine_id === "—" ? null : row.machine_id)}</td><td className="num">{num(row.runs)}</td><td className="num">{num(row.on_plan)}</td><td className="num">{num(row.off_plan)}</td><td className="num">{num(row.unplanned)}</td><td className="num">{pct(row.adherence_pct)}</td></tr>)}</tbody>
                </table>
              </div>
            </Section>
          </div>

          <Section title="Job cards furthest from plan" subtitle="Cards with the most runs off plan or before planning">
            <div className="-mx-4 -mb-4 overflow-x-auto">
              <table className="tube-grid w-full"><thead><tr><th>Job card</th><th>Customer</th><th className="num">Runs</th><th className="num">As planned</th><th className="num">Different</th><th className="num">Before planning</th></tr></thead>
                <tbody>{(data.cards || []).slice(0, 20).map((row: any) => <tr key={row.job_card_id}><td><Link href={`/production/job-cards/${row.job_card_id}`} className="font-semibold text-primary">{row.job_card_no}</Link></td><td>{row.customer || "—"}</td><td className="num">{num(row.runs)}</td><td className="num">{num(row.on_plan)}</td><td className="num">{num(row.off_plan)}</td><td className="num">{num(row.unplanned)}</td></tr>)}</tbody>
              </table>
            </div>
          </Section>
        </>
      )}
    </div>
  )
}
