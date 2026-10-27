"use client"

import Link from "next/link"
import { useMemo, useState, type ReactNode } from "react"
import { ArrowDown, ArrowUp, CheckCircle2, Download, Flag, Search, X } from "lucide-react"
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

import { ErrorState, LoadingState } from "@/components/workspace/query-state"
import { useMachines } from "@/hooks/use-production"
import {
  STAGE_LABEL,
  bandText,
  directionWord,
  flagMatches,
  indianDay,
  indianTime,
  offBy,
  parameterSummary,
  shiftLabel,
  stageCounts,
  type QcFlagRow,
} from "@/lib/qc-flags"
import { cn } from "@/lib/utils"

const PAGE = 50
const PERIODS = [{ label: "7 days", days: 7 }, { label: "30 days", days: 30 }, { label: "90 days", days: 90 }]
export const isoDay = (date: Date) => date.toLocaleDateString("en-CA")
export const daysAgo = (days: number) => { const d = new Date(); d.setDate(d.getDate() - days); return isoDay(d) }
const count = (value: number) => value.toLocaleString("en-IN")

export function Tile({ label, value, hint, tone, icon }: { label: string; value: string; hint?: string; tone?: string; icon?: ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <p className="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground">{icon}{label}</p>
      <p className={cn("mt-1 text-[22px] font-semibold tabular-nums leading-tight", tone)}>{value}</p>
      {hint ? <p className="mt-0.5 text-[12px] text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

export function Section({ title, subtitle, children, action, flush, testId }: { title: string; subtitle?: string; children: ReactNode; action?: ReactNode; flush?: boolean; testId?: string }) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card" data-testid={testId}>
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0"><h2 className="font-semibold">{title}</h2>{subtitle ? <p className="text-[12.5px] text-muted-foreground">{subtitle}</p> : null}</div>
        {action}
      </header>
      <div className={flush ? "" : "p-4"}>{children}</div>
    </section>
  )
}

/** Amber flag chip: icon + words, never colour alone. */
export function FlagChip({ direction, off, unit }: { direction?: string | null; off?: number | null; unit?: string | null }) {
  const Icon = direction === "HIGH" ? ArrowUp : direction === "LOW" ? ArrowDown : Flag
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-signal-amber-line bg-signal-amber-soft px-2 py-0.5 text-[11.5px] font-semibold text-signal-amber-ink">
      <Icon className="h-3 w-3" aria-hidden="true" />
      {directionWord(direction)}
      {off != null ? <span className="font-normal">· {off.toLocaleString("en-IN", { maximumFractionDigits: 3 })}{unit ? ` ${unit}` : ""} {direction === "LOW" ? "under" : "over"}</span> : null}
    </span>
  )
}

export function QcFlagsRegister({
  rows,
  isLoading,
  isError,
  onRetry,
  from,
  to,
  setFrom,
  setTo,
  cardFilter,
  onClearCard,
}: {
  rows: QcFlagRow[]
  isLoading: boolean
  isError: boolean
  onRetry: () => void
  from: string
  to: string
  setFrom: (value: string) => void
  setTo: (value: string) => void
  cardFilter?: { id: string; no?: string | null } | null
  onClearCard?: () => void
}) {
  const [stage, setStage] = useState("")
  const [parameter, setParameter] = useState("")
  const [direction, setDirection] = useState("")
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(0)
  const machinesQuery = useMachines()
  const machineName = useMemo(() => {
    const list: any[] = Array.isArray(machinesQuery.data) ? machinesQuery.data : []
    const map = new Map(list.map((row) => [String(row.id), String(row.name || row.code || "")]))
    return (id?: string | null) => (id ? map.get(String(id)) || "" : "")
  }, [machinesQuery.data])

  // Search applies before the stage tabs, so each tab shows how many of the matching readings it holds.
  const searched = useMemo(() => rows.filter((row) => flagMatches(row, search)), [rows, search])
  const perStage = useMemo(() => stageCounts(searched), [searched])
  const inStage = useMemo(() => searched.filter((row) => !stage || row.stage === stage), [searched, stage])
  const summary = useMemo(() => parameterSummary(inStage), [inStage])
  const parameterOptions = useMemo(() => Array.from(new Set(inStage.map((row) => row.label))).sort(), [inStage])
  const shown = useMemo(
    () => inStage.filter((row) => (!parameter || row.label === parameter) && (!direction || row.direction === direction)),
    [inStage, parameter, direction],
  )
  const pageRows = shown.slice(page * PAGE, page * PAGE + PAGE)
  const runs = new Set(shown.map((row) => row.entry_id)).size
  const cards = new Set(shown.map((row) => row.job_card_id)).size
  const high = shown.filter((row) => row.direction === "HIGH").length
  const low = shown.filter((row) => row.direction === "LOW").length
  const chart = perStage.map((row) => ({ stage: row.label, HIGH: row.high, LOW: row.low }))
  const resetPage = () => setPage(0)

  const exportExcel = async () => {
    const ExcelJS = await import("exceljs")
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet("Flagged QC readings")
    sheet.addRow(["Date", "Shift", "Job card", "Customer", "Order", "Stage", "Run", "Machine", "Check", "Reading", "Unit", "Band min", "Band max", "High / Low", "Outside by", "Sample", "Operator", "Logged by", "Logged at"])
    for (const row of shown) {
      sheet.addRow([row.business_date || "", shiftLabel(row.shift_code), row.job_card_no || "", row.customer || "", row.sales_order_no || "", STAGE_LABEL[row.stage] || row.stage, row.run || "", machineName(row.machine_id), row.label, row.value ?? "", row.unit || "", row.min ?? "", row.max ?? "", directionWord(row.direction), offBy(row) ?? "", row.sample_id || "", row.operator || "", row.logged_by || "", indianTime(row.logged_at)])
    }
    sheet.getRow(1).font = { bold: true }
    sheet.views = [{ state: "frozen", ySplit: 1 }]
    const byCheck = workbook.addWorksheet("By stage and check")
    byCheck.addRow(["Stage", "Check", "Readings", "High", "Low", "Runs", "Job cards", "Most outside by"])
    for (const row of parameterSummary(shown)) byCheck.addRow([STAGE_LABEL[row.stage] || row.stage, row.label, row.readings, row.high, row.low, row.runs, row.cards, row.worst ?? ""])
    byCheck.getRow(1).font = { bold: true }
    const buffer = await workbook.xlsx.writeBuffer()
    const link = document.createElement("a")
    link.href = URL.createObjectURL(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }))
    link.download = cardFilter ? `qc-flags-${String(cardFilter.no || cardFilter.id).replace(/\//g, "-")}.xlsx` : `qc-flags-${from}-to-${to}.xlsx`
    link.click()
    URL.revokeObjectURL(link.href)
  }

  return (
    <div className="space-y-4" data-testid="qc-flags-register">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card px-4 py-3">
        {cardFilter ? (
          <span className="inline-flex h-9 items-center gap-2 rounded-lg border border-signal-cyan-line bg-signal-cyan-soft px-3 text-[13px] font-semibold text-signal-cyan-ink" data-testid="qc-flags-card-filter">
            Card {cardFilter.no || "…"} · every date
            {onClearCard ? <button type="button" onClick={onClearCard} className="rounded p-0.5 hover:bg-card" aria-label="Show every card"><X className="h-3.5 w-3.5" /></button> : null}
          </span>
        ) : (
          <>
            <div className="tube-segment" role="group" aria-label="Period">
              {PERIODS.map((period) => (
                <button key={period.days} type="button" aria-pressed={from === daysAgo(period.days) && to === isoDay(new Date())} onClick={() => { setFrom(daysAgo(period.days)); setTo(isoDay(new Date())); resetPage() }}>{period.label}</button>
              ))}
            </div>
            <label className="grid gap-1 text-[12px] font-medium text-muted-foreground">From<input type="date" value={from} max={to} onChange={(event) => { setFrom(event.target.value); resetPage() }} className="h-9 rounded-lg border border-input bg-card px-2 text-[13px] text-foreground" /></label>
            <label className="grid gap-1 text-[12px] font-medium text-muted-foreground">To<input type="date" value={to} min={from} onChange={(event) => { setTo(event.target.value); resetPage() }} className="h-9 rounded-lg border border-input bg-card px-2 text-[13px] text-foreground" /></label>
          </>
        )}
        <label className="relative ml-auto min-w-[220px] flex-1 sm:max-w-xs">
          <span className="sr-only">Search card, customer or order</span>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input value={search} onChange={(event) => { setSearch(event.target.value); resetPage() }} placeholder="Card, customer or order" className="h-9 w-full rounded-lg border border-input bg-card pl-8 pr-2 text-[13px] text-foreground" data-testid="qc-flags-search" />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="tube-segment" role="tablist" aria-label="Stage" data-testid="qc-flags-stage-tabs">
          <button type="button" role="tab" aria-selected={stage === ""} onClick={() => { setStage(""); setParameter(""); resetPage() }}>All stages <span className="tabular-nums text-muted-foreground">{count(searched.length)}</span></button>
          {perStage.map((row) => (
            <button key={row.stage} type="button" role="tab" aria-selected={stage === row.stage} onClick={() => { setStage(row.stage); setParameter(""); resetPage() }}>
              {row.label} <span className={cn("tabular-nums", row.readings ? "font-semibold text-signal-amber-ink" : "text-muted-foreground")}>{count(row.readings)}</span>
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-[12.5px] font-medium text-muted-foreground">
          Check
          <select value={parameter} onChange={(event) => { setParameter(event.target.value); resetPage() }} className="h-9 rounded-lg border border-input bg-card px-2 text-[13px] text-foreground" data-testid="qc-flags-parameter">
            <option value="">All checks</option>
            {parameterOptions.map((label) => <option key={label} value={label}>{label}</option>)}
          </select>
        </label>
        <div className="tube-segment" role="group" aria-label="High or low">
          {[["", "High and low"], ["HIGH", "High"], ["LOW", "Low"]].map(([value, label]) => (
            <button key={value || "all"} type="button" aria-pressed={direction === value} onClick={() => { setDirection(value); resetPage() }}>{value === "HIGH" ? <ArrowUp className="h-3 w-3" aria-hidden="true" /> : value === "LOW" ? <ArrowDown className="h-3 w-3" aria-hidden="true" /> : null}{label}</button>
          ))}
        </div>
      </div>

      {isLoading ? <LoadingState label="Loading flagged QC readings…" /> : isError ? <ErrorState title="Flagged readings could not load" message="Refresh to retry. This is not an empty list." onRetry={onRetry} /> : (
        <>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <Tile label="Flagged readings" value={count(shown.length)} hint={stage ? STAGE_LABEL[stage] : "Winding, oven and process"} tone={shown.length ? "text-signal-amber-ink" : ""} icon={<Flag className="h-3.5 w-3.5" aria-hidden="true" />} />
            <Tile label="Runs with a flag" value={count(runs)} hint="Saved and allowed to move on; nothing is held" />
            <Tile label="Job cards" value={count(cards)} hint={cards ? "Open a card to see its flagged runs" : "No card has a flag"} />
            <Tile label="High · Low" value={`${count(high)} · ${count(low)}`} hint="Above the band · below the band" />
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
            <Section title="By stage" subtitle="Flagged readings per stage, above or below the band">
              {searched.length ? (
                <div className="h-44" aria-label="Flagged readings by stage">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chart} layout="vertical" margin={{ left: 4, right: 16 }} barCategoryGap={10}>
                      <CartesianGrid horizontal={false} stroke="hsl(var(--chart-grid))" />
                      <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                      <YAxis type="category" dataKey="stage" width={64} tick={{ fontSize: 12 }} />
                      <Tooltip cursor={{ fill: "hsl(var(--foreground) / .04)" }} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="HIGH" name="Above band (high)" stackId="flags" fill="hsl(var(--signal-amber-ink))" stroke="hsl(var(--card))" strokeWidth={2} maxBarSize={20} />
                      <Bar dataKey="LOW" name="Below band (low)" stackId="flags" fill="hsl(var(--signal-blue-ink))" stroke="hsl(var(--card))" strokeWidth={2} radius={[0, 4, 4, 0]} maxBarSize={20} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : <p className="flex items-center gap-2 text-sm text-muted-foreground"><CheckCircle2 className="h-4 w-4 text-signal-emerald-ink" aria-hidden="true" />No flagged readings to chart.</p>}
            </Section>
            <Section title="By check" subtitle="Which checks go outside their band most · pick one to list it" flush testId="qc-flags-by-check">
              {summary.length ? (
                <div className="overflow-x-auto">
                  <table className="tube-grid w-full min-w-[520px]">
                    <thead><tr><th>Stage</th><th>Check</th><th className="num">Readings</th><th className="num">High</th><th className="num">Low</th><th className="num">Runs</th><th className="num">Cards</th><th className="num">Most outside by</th></tr></thead>
                    <tbody>
                      {summary.map((row) => (
                        <tr key={row.key} data-state={parameter === row.label && stage === row.stage ? "selected" : undefined} className="cursor-pointer" onClick={() => { setStage(row.stage); setParameter(row.label); resetPage() }}>
                          <td>{STAGE_LABEL[row.stage] || row.stage}</td>
                          <td className="font-semibold">{row.label}</td>
                          <td className="num font-semibold text-signal-amber-ink">{count(row.readings)}</td>
                          <td className="num">{count(row.high)}</td>
                          <td className="num">{count(row.low)}</td>
                          <td className="num">{count(row.runs)}</td>
                          <td className="num">{count(row.cards)}</td>
                          <td className="num">{row.worst == null ? "—" : `${row.worst.toLocaleString("en-IN", { maximumFractionDigits: 3 })}${row.unit ? ` ${row.unit}` : ""}`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p className="p-4 text-sm text-muted-foreground">No flagged checks {stage ? `at ${STAGE_LABEL[stage]}` : "in this period"}.</p>}
            </Section>
          </div>

          <Section
            title="Flagged readings"
            subtitle={`${count(shown.length)} reading${shown.length === 1 ? "" : "s"} outside the band · newest first · the run was saved and is not held`}
            action={<button type="button" className="erp-btn-secondary !h-9" onClick={() => void exportExcel()} disabled={!shown.length} data-testid="qc-flags-excel"><Download className="h-4 w-4" />Excel</button>}
            flush
            testId="qc-flags-table"
          >
            {pageRows.length ? (
              <>
              {/* Phone: one card per flagged reading. */}
              <ul className="divide-y divide-border md:hidden" data-testid="qc-flags-cards">
                {pageRows.map((row, index) => (
                  <li key={`m:${row.entry_id}:${row.sample_id || index}:${row.label}:${index}`} className="space-y-1 px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <Link href={`/production/job-cards/${row.job_card_id}`} className="font-semibold text-primary">{row.job_card_no || "Job card"}</Link>
                      <span className="text-[12px] text-muted-foreground">{indianDay(row.business_date)} · {shiftLabel(row.shift_code)}</span>
                    </div>
                    <p className="text-[12.5px] text-muted-foreground">{STAGE_LABEL[row.stage] || row.stage} · {row.run}{row.sales_order_no ? ` · ${row.sales_order_no}` : ""}</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{row.label} {row.value == null ? "—" : row.value.toLocaleString("en-IN", { maximumFractionDigits: 3 })}{row.unit ? ` ${row.unit}` : ""}</span>
                      <FlagChip direction={row.direction} off={offBy(row)} unit={row.unit} />
                    </div>
                    <p className="text-[12px] text-muted-foreground">band {bandText(row.min, row.max, row.unit)} · {row.operator || row.logged_by || "—"}</p>
                  </li>
                ))}
              </ul>
              <div className="hidden overflow-x-auto md:block">
                <table className="tube-grid w-full min-w-[900px]">
                  <thead><tr><th>Date · shift</th><th>Job card · order</th><th>Stage · run</th><th>Check</th><th>Reading against band</th><th>Operator · logged by</th></tr></thead>
                  <tbody>
                    {pageRows.map((row, index) => (
                      <tr key={`${row.entry_id}:${row.sample_id || index}:${row.label}:${index}`}>
                        <td className="whitespace-nowrap">{indianDay(row.business_date)}<span className="block text-[11.5px] text-muted-foreground">{shiftLabel(row.shift_code)}</span></td>
                        <td><Link href={`/production/job-cards/${row.job_card_id}`} className="font-semibold text-primary hover:underline">{row.job_card_no || "Job card"}</Link><span className="block max-w-[240px] truncate text-[11.5px] text-muted-foreground">{[row.sales_order_no, row.customer].filter(Boolean).join(" · ")}</span></td>
                        <td className="whitespace-nowrap">{STAGE_LABEL[row.stage] || row.stage}<span className="block text-[11.5px] text-muted-foreground">{[row.run, machineName(row.machine_id), row.status === "DRAFT" ? "draft" : ""].filter(Boolean).join(" · ")}</span></td>
                        <td className="font-semibold">{row.label}</td>
                        <td>
                          <div className="flex items-center gap-2 whitespace-nowrap">
                            <span className="font-semibold tabular-nums">{row.value == null ? "—" : row.value.toLocaleString("en-IN", { maximumFractionDigits: 3 })}{row.unit ? <span className="text-[11.5px] font-normal text-muted-foreground"> {row.unit}</span> : null}</span>
                            <FlagChip direction={row.direction} off={offBy(row)} unit={row.unit} />
                          </div>
                          <span className="block text-[11.5px] text-muted-foreground">band {bandText(row.min, row.max, row.unit)}</span>
                        </td>
                        <td>{row.operator || "—"}<span className="block max-w-[220px] truncate text-[11.5px] text-muted-foreground" title={row.logged_by || ""}>{[row.logged_by, indianTime(row.logged_at)].filter(Boolean).join(" · ")}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {shown.length > PAGE ? (
                <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-2 text-[12.5px]">
                  <span className="text-muted-foreground">{page * PAGE + 1}–{Math.min(shown.length, page * PAGE + PAGE)} of {count(shown.length)}</span>
                  <button type="button" className="erp-btn-secondary !h-8" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>Previous</button>
                  <button type="button" className="erp-btn-secondary !h-8" disabled={(page + 1) * PAGE >= shown.length} onClick={() => setPage((value) => value + 1)}>Next</button>
                </div>
              ) : null}
              </>
            ) : (
              <div className="px-6 py-10 text-center" data-testid="qc-flags-empty">
                <CheckCircle2 className="mx-auto mb-2 h-7 w-7 text-signal-emerald-ink" aria-hidden="true" />
                <p className="font-semibold">{rows.length ? "No flagged readings match" : cardFilter ? "No flagged readings on this card" : "No flagged readings in this period"}</p>
                <p className="mt-1 text-[12.5px] text-muted-foreground">{rows.length ? "Change the stage, check or search." : "Every QC reading logged was inside its band."}</p>
              </div>
            )}
          </Section>
        </>
      )}
    </div>
  )
}

