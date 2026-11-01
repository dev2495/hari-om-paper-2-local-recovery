"use client"

import Link from "next/link"
import { Fragment, useMemo, useState, type ReactNode } from "react"
import { useQuery } from "@tanstack/react-query"
import { ChevronDown, ChevronRight, Download, Users } from "lucide-react"

import { PageHeader } from "@/components/workspace/page-header"
import { RoleGate } from "@/components/workspace/role-gate"
import { ErrorState, LoadingState } from "@/components/workspace/query-state"
import { api } from "@/lib/api"
import {
  STAGE_LABEL, byOperator, departmentWord, employeeCsv, pctWord, shiftWord, unitWord,
  type EmployeeRow, type EmployeeRun,
} from "@/lib/employee-report"
import { cn } from "@/lib/utils"

/**
 * Employee performance (owner decision 7, 1 Nov 2026): per operator for a date range, shift, stage and
 * department — runs, made, good, rejected, reject %, flagged QC readings and shifts worked — from the operator
 * recorded on every floor log (batch entries and old card forms), with the runs behind each row.
 */
const STAGES = [["", "All stages"], ["WINDER", "Winding"], ["OVEN", "Oven"], ["PROCESS", "Process"]] as const
const SHIFTS = [["", "All shifts"], ["SHIFT_A", "Shift A"], ["SHIFT_B", "Shift B"]] as const
const PERIODS = [{ label: "7 days", days: 7 }, { label: "30 days", days: 30 }, { label: "90 days", days: 90 }]
const iso = (date: Date) => date.toLocaleDateString("en-CA")
const daysAgo = (days: number) => { const d = new Date(); d.setDate(d.getDate() - days); return iso(d) }
const num = (value?: number | null) => Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })
const day = (value?: string | null) => (value ? new Date(`${String(value).slice(0, 10)}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "—")
const when = (value?: string | null) => {
  if (!value) return "—"
  if (!String(value).includes("T")) return day(value)
  const moment = new Date(String(value).endsWith("Z") ? String(value) : `${value}Z`)
  return Number.isNaN(moment.getTime()) ? day(value) : moment.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
}

type Report = {
  date_from: string; date_to: string; departments: string[]; employees_loaded: boolean
  totals: { operators: number; runs: number; flagged_qc: number; by_unit: Record<string, { made: number; good: number; rejected: number; reject_pct: number | null }> }
  rows: EmployeeRow[]; runs: EmployeeRun[] | null
}

function Tile({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <p className="text-[12px] font-medium text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-[22px] font-semibold tabular-nums leading-tight", tone)}>{value}</p>
      {hint ? <p className="mt-0.5 text-[12px] text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

function Select({ label, value, onChange, children, testId }: { label: string; value: string; onChange: (value: string) => void; children: ReactNode; testId?: string }) {
  return (
    <label className="grid gap-1 text-[12px] font-medium text-muted-foreground">
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)} className="h-11 rounded-lg border border-input bg-card px-2 text-[13px] text-foreground sm:h-9" data-testid={testId}>{children}</select>
    </label>
  )
}

export default function EmployeePerformancePage() {
  return (
    <RoleGate allow={["Owner", "Admin", "PlantManager", "Planner"]}>
      <EmployeePerformance />
    </RoleGate>
  )
}

function EmployeePerformance() {
  const [from, setFrom] = useState(daysAgo(30))
  const [to, setTo] = useState(iso(new Date()))
  const [stage, setStage] = useState("")
  const [shift, setShift] = useState("")
  const [department, setDepartment] = useState("")
  const [open, setOpen] = useState<string | null>(null)
  const filters = { date_from: from, date_to: to, stage: stage || undefined, shift: shift || undefined, department: department || undefined }
  const query = useQuery({
    queryKey: ["employee-performance", filters],
    queryFn: async () => (await api.get<Report>("/api/production/reports/employees", { params: filters })).data,
  })
  const drill = useQuery({
    queryKey: ["employee-performance-runs", filters, open],
    queryFn: async () => (await api.get<Report>("/api/production/reports/employees", { params: { ...filters, operator: open } })).data,
    enabled: Boolean(open),
  })
  const data = query.data
  const rows = useMemo(() => (Array.isArray(data?.rows) ? data!.rows : []), [data])
  const groups = useMemo(() => byOperator(rows), [rows])
  const departments = useMemo(() => Array.from(new Set(["WINDER", "OVEN", "PROCESS", "PACKING", ...(data?.departments || [])])), [data?.departments])
  const pcs = data?.totals.by_unit?.pcs
  const bamboo = data?.totals.by_unit?.bamboo

  const download = () => {
    const csv = employeeCsv(rows, { from, to, shift, stage, department })
    const link = document.createElement("a")
    link.href = URL.createObjectURL(new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" }))
    link.download = `employee-performance-${from}-to-${to}.csv`
    link.click()
    URL.revokeObjectURL(link.href)
  }

  return (
    <div className="space-y-4" data-testid="employee-performance">
      <PageHeader
        badge="Reports"
        title="Employee performance"
        description="What each operator made in the period: runs, made, good, rejected and reject %, QC readings flagged out of band, and the shifts worked. Taken from the operator chosen on every floor log; departments come from Masters › Employees. Quantities are in each stage's unit (bamboos at Winding and Oven, pieces at Process)."
        actions={<button type="button" className="erp-btn-secondary !h-11" onClick={download} disabled={!rows.length} data-testid="employee-csv"><Download className="h-4 w-4" aria-hidden="true" />CSV</button>}
      />

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card px-4 py-3">
        <div className="tube-segment" role="group" aria-label="Period">
          {PERIODS.map((period) => (
            <button key={period.days} type="button" aria-pressed={from === daysAgo(period.days) && to === iso(new Date())} onClick={() => { setFrom(daysAgo(period.days)); setTo(iso(new Date())); setOpen(null) }}>{period.label}</button>
          ))}
        </div>
        <label className="grid gap-1 text-[12px] font-medium text-muted-foreground">From<input type="date" value={from} max={to} onChange={(event) => { setFrom(event.target.value); setOpen(null) }} className="h-11 rounded-lg border border-input bg-card px-2 text-[13px] text-foreground sm:h-9" data-testid="employee-from" /></label>
        <label className="grid gap-1 text-[12px] font-medium text-muted-foreground">To<input type="date" value={to} min={from} onChange={(event) => { setTo(event.target.value); setOpen(null) }} className="h-11 rounded-lg border border-input bg-card px-2 text-[13px] text-foreground sm:h-9" data-testid="employee-to" /></label>
        <Select label="Stage" value={stage} onChange={(value) => { setStage(value); setOpen(null) }} testId="employee-stage">{STAGES.map(([value, label]) => <option key={value || "all"} value={value}>{label}</option>)}</Select>
        <Select label="Shift" value={shift} onChange={(value) => { setShift(value); setOpen(null) }} testId="employee-shift">{SHIFTS.map(([value, label]) => <option key={value || "all"} value={value}>{label}</option>)}</Select>
        <Select label="Department" value={department} onChange={(value) => { setDepartment(value); setOpen(null) }} testId="employee-department">
          <option value="">All departments</option>
          {departments.map((value) => <option key={value} value={value}>{departmentWord(value)}</option>)}
        </Select>
      </div>

      {query.isLoading ? <LoadingState label="Adding up the floor logs…" /> : query.isError || !data ? <ErrorState title="Employee performance could not load" message="Refresh to retry." onRetry={() => { void query.refetch() }} /> : (
        <>
          {!data.employees_loaded ? <p className="rounded-lg border border-signal-amber-line bg-signal-amber-soft px-3 py-2 text-sm text-signal-amber-ink">Masters › Employees could not be read just now, so departments are missing. The figures are complete.</p> : null}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Tile label="Operators" value={num(data.totals.operators)} hint={`${num(data.totals.runs)} runs logged`} />
            <Tile label="Process pieces" value={pcs ? num(pcs.good) : "—"} hint={pcs ? `good of ${num(pcs.made)} made · ${pctWord(pcs.reject_pct)} rejected` : "No Process runs"} />
            <Tile label="Winding / Oven bamboos" value={bamboo ? num(bamboo.good) : "—"} hint={bamboo ? `good of ${num(bamboo.made)} made · ${pctWord(bamboo.reject_pct)} rejected` : "No Winding or Oven runs"} />
            <Tile label="Flagged QC readings" value={num(data.totals.flagged_qc)} hint="Readings outside the band (flagged, never held)" tone={data.totals.flagged_qc ? "text-signal-amber-ink" : ""} />
          </div>

          <section className="overflow-hidden rounded-xl border border-border bg-card">
            <header className="border-b border-border px-4 py-3">
              <h2 className="font-semibold">By operator</h2>
              <p className="text-[12.5px] text-muted-foreground">{num(groups.length)} operator{groups.length === 1 ? "" : "s"} · choose a row to see the runs behind it</p>
            </header>
            {groups.length ? (
              <div className="overflow-x-auto">
                <table className="tube-grid w-full min-w-[980px]" data-testid="employee-table">
                  <thead><tr><th>Operator</th><th>Stage</th><th className="num">Runs</th><th className="num">Made</th><th className="num">Good</th><th className="num">Rejected</th><th className="num">Reject %</th><th className="num">Flagged QC</th><th className="num">Shifts</th><th>Last activity</th></tr></thead>
                  <tbody>
                    {groups.map((group) => group.rows.map((row, index) => {
                      const rowKey = `${row.operator_key}:${row.stage}`
                      const expanded = open === row.operator_key
                      return (
                        <Fragment key={rowKey}>
                          <tr className={cn("cursor-pointer hover:bg-muted/60", expanded && "bg-muted/60")} onClick={() => setOpen(expanded ? null : row.operator_key)} data-testid="employee-row">
                            <td>
                              {index === 0 ? (
                                <button type="button" className="flex min-h-11 items-start gap-1.5 text-left sm:min-h-0" aria-expanded={expanded} onClick={(event) => { event.stopPropagation(); setOpen(expanded ? null : row.operator_key) }}>
                                  {expanded ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
                                  <span><span className="font-semibold text-foreground">{group.name}</span><span className="block text-[11.5px] text-muted-foreground">{[group.code, departmentWord(group.department)].filter(Boolean).join(" · ")}</span></span>
                                </button>
                              ) : null}
                            </td>
                            <td>{STAGE_LABEL[row.stage] || row.stage}<span className="block text-[11.5px] text-muted-foreground">{unitWord(row.unit)}{row.hours != null ? ` · ${row.hours} h on cards` : ""}</span></td>
                            <td className="num">{num(row.runs)}</td>
                            <td className="num">{num(row.made)}</td>
                            <td className="num">{num(row.good)}</td>
                            <td className="num">{num(row.rejected)}</td>
                            <td className={cn("num", row.reject_pct != null && row.reject_pct >= 5 && "font-semibold text-signal-amber-ink")}>{pctWord(row.reject_pct)}</td>
                            <td className={cn("num", row.flagged_qc ? "font-semibold text-signal-amber-ink" : "")}>{num(row.flagged_qc)}<span className="block text-[11px] font-normal text-muted-foreground">of {num(row.qc_readings)}</span></td>
                            <td className="num">{num(row.shifts_worked)}<span className="block text-[11px] text-muted-foreground">{num(row.days_worked)} day{row.days_worked === 1 ? "" : "s"}</span></td>
                            <td className="whitespace-nowrap">{when(row.last_activity)}</td>
                          </tr>
                          {expanded && index === group.rows.length - 1 ? (
                            <tr>
                              <td colSpan={10} className="bg-muted/40 !p-0">
                                <RunList query={drill} />
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      )
                    }))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-sm text-muted-foreground">
                <Users className="h-6 w-6" aria-hidden="true" />
                No floor logs with an operator in this period{department ? ` for the ${departmentWord(department)} department` : ""}.
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}

function RunList({ query }: { query: { isLoading: boolean; isError: boolean; data?: Report } }) {
  if (query.isLoading) return <p className="px-4 py-3 text-sm text-muted-foreground">Loading the runs…</p>
  if (query.isError) return <p className="px-4 py-3 text-sm text-signal-rose-ink">The runs could not load. Choose the row again.</p>
  const runs = query.data?.runs || []
  if (!runs.length) return <p className="px-4 py-3 text-sm text-muted-foreground">No runs.</p>
  return (
    <div className="px-4 py-3" data-testid="employee-runs">
      <table className="w-full text-[12.5px]">
        <thead className="text-left text-[11.5px] text-muted-foreground"><tr><th className="py-1 pr-3 font-semibold">Date · shift</th><th className="py-1 pr-3 font-semibold">Job card</th><th className="py-1 pr-3 font-semibold">Stage · run</th><th className="py-1 pr-3 text-right font-semibold">Made</th><th className="py-1 pr-3 text-right font-semibold">Good</th><th className="py-1 pr-3 text-right font-semibold">Rejected</th><th className="py-1 text-right font-semibold">Flagged QC</th></tr></thead>
        <tbody>
          {runs.map((run, index) => (
            <tr key={`${run.job_card_id}:${run.run}:${index}`} className="border-t border-border/70">
              <td className="whitespace-nowrap py-1.5 pr-3">{day(run.date)} · {shiftWord(run.shift)}</td>
              <td className="py-1.5 pr-3"><Link href={`/production/job-cards/${run.job_card_id}`} className="font-semibold text-primary" onClick={(event) => event.stopPropagation()}>{run.job_card_no || "Job card"}</Link>{run.customer ? <span className="text-muted-foreground"> · {run.customer}</span> : null}</td>
              <td className="py-1.5 pr-3">{STAGE_LABEL[run.stage] || run.stage} · {run.run}{run.source === "CARD_FORM" ? <span className="text-muted-foreground"> (old card form)</span> : null}</td>
              <td className="py-1.5 pr-3 text-right tabular-nums">{run.kind === "QC" ? "—" : num(run.made)}</td>
              <td className="py-1.5 pr-3 text-right tabular-nums">{run.kind === "QC" ? "—" : num(run.good)}</td>
              <td className="py-1.5 pr-3 text-right tabular-nums">{run.kind === "QC" ? "—" : num(run.rejected)}</td>
              <td className={cn("py-1.5 text-right tabular-nums", run.flagged_qc ? "font-semibold text-signal-amber-ink" : "")}>{num(run.flagged_qc)}{run.qc_readings ? <span className="font-normal text-muted-foreground"> of {num(run.qc_readings)}</span> : null}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
