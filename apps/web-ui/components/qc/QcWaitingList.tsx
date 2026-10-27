"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { ClipboardCheck, ClipboardList, Clock3, Search } from "lucide-react"

import { ErrorState, LoadingState } from "@/components/workspace/query-state"
import { Section, Tile } from "@/components/qc/QcFlagsRegister"
import { QC_STAGES, STAGE_LABEL, indianDay, logQcHref, missingText, shiftLabel, waitingState, type QcDueRow } from "@/lib/qc-flags"
import { cn } from "@/lib/utils"

const toDate = (value?: string | null) => (value ? new Date(/Z$|[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}Z`) : null)
function waitingFor(value?: string | null) {
  const date = toDate(value)
  if (!date || Number.isNaN(date.getTime())) return ""
  const hours = (Date.now() - date.getTime()) / 3_600_000
  return hours < 1 ? "under 1 h" : hours < 48 ? `${Math.floor(hours)} h` : `${Math.floor(hours / 24)} days`
}

/** Runs on running cards whose QC is not done yet (`GET /api/production/entries/qc-due`). */
export function QcWaitingList({ rows, isLoading, isError, onRetry, canLog }: { rows: QcDueRow[]; isLoading: boolean; isError: boolean; onRetry: () => void; canLog: boolean }) {
  const [stage, setStage] = useState("")
  const [search, setSearch] = useState("")
  const searched = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return rows.filter((row) => !needle || [row.job_card_no, row.customer].some((value) => String(value || "").toLowerCase().includes(needle)))
  }, [rows, search])
  const shown = searched.filter((row) => !stage || row.stage === stage)
  const cards = new Set(shown.map((row) => row.job_card_id)).size
  const noReadings = shown.filter((row) => row.state === "NO_READINGS").length

  return (
    <div className="space-y-4" data-testid="qc-waiting">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
        <div className="tube-segment" role="tablist" aria-label="Stage" data-testid="qc-waiting-stage-tabs">
          <button type="button" role="tab" aria-selected={stage === ""} onClick={() => setStage("")}>All stages <span className="tabular-nums text-muted-foreground">{searched.length}</span></button>
          {QC_STAGES.map((item) => {
            const n = searched.filter((row) => row.stage === item.key).length
            return <button key={item.key} type="button" role="tab" aria-selected={stage === item.key} onClick={() => setStage(item.key)}>{item.label} <span className={cn("tabular-nums", n ? "font-semibold text-signal-amber-ink" : "text-muted-foreground")}>{n}</span></button>
          })}
        </div>
        <label className="relative ml-auto min-w-[220px] flex-1 sm:max-w-xs">
          <span className="sr-only">Search card or customer</span>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Card or customer" className="h-9 w-full rounded-lg border border-input bg-card pl-8 pr-2 text-[13px] text-foreground" data-testid="qc-waiting-search" />
        </label>
      </div>

      {isLoading ? <LoadingState label="Loading runs waiting for QC…" /> : isError ? <ErrorState title="Runs waiting for QC could not load" message="Refresh to retry. This is not an empty list." onRetry={onRetry} /> : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Tile label="Runs waiting for readings" value={String(shown.length)} hint={stage ? STAGE_LABEL[stage] : "Winding, oven and process"} tone={shown.length ? "text-signal-amber-ink" : ""} icon={<Clock3 className="h-3.5 w-3.5" aria-hidden="true" />} />
            <Tile label="Job cards" value={String(cards)} hint="Running cards only" />
            <Tile label="No readings yet" value={String(noReadings)} hint={`${shown.length - noReadings} have some readings, need more`} />
          </div>
          <Section
            title="Waiting for readings"
            subtitle="Oldest first. A run is QC done with at least 2 readings on every required check (moisture is optional). The next stage takes only QC-done runs, and a stage closes only when its QC is ready."
            flush
            testId="qc-waiting-table"
          >
            {shown.length ? (
              <>
              {/* Phone: one card per run, the Log QC button within thumb reach. */}
              <ul className="divide-y divide-border md:hidden" data-testid="qc-waiting-cards">
                {shown.map((row) => (
                  <li key={`m:${row.entry_id}`} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="font-semibold"><Link href={`/production/job-cards/${row.job_card_id}`} className="text-primary">{row.job_card_no || "Job card"}</Link> · {STAGE_LABEL[row.stage] || row.stage} run #{row.entry_no ?? "—"}</p>
                      <p className="text-[12px] text-muted-foreground">{indianDay(row.business_date)} · {shiftLabel(row.shift_code)} · {Number(row.accepted || 0).toLocaleString("en-IN")} {row.unit || ""} good · waiting {waitingFor(row.created_at)}</p>
                      <p className="text-[12px] font-medium text-signal-amber-ink">{waitingState(row)}: {missingText(row)}</p>
                    </div>
                    {canLog ? <Link href={logQcHref(row.job_card_id, row.stage)} className="erp-btn-primary !h-11 shrink-0">Log QC</Link> : null}
                  </li>
                ))}
              </ul>
              <div className="hidden overflow-x-auto md:block">
                <table className="tube-grid w-full min-w-[860px]">
                  <thead><tr><th>Job card</th><th>Stage · run</th><th>Ran</th><th className="num">Good</th><th>Still needed (have / need)</th><th>Waiting</th><th /></tr></thead>
                  <tbody>
                    {shown.map((row) => (
                      <tr key={row.entry_id}>
                        <td><Link href={`/production/job-cards/${row.job_card_id}`} className="font-semibold text-primary hover:underline">{row.job_card_no || "Job card"}</Link><span className="block max-w-[200px] truncate text-[11.5px] text-muted-foreground">{row.customer || ""}</span></td>
                        <td className="whitespace-nowrap">{STAGE_LABEL[row.stage] || row.stage}<span className="block text-[11.5px] text-muted-foreground">Run #{row.entry_no ?? "—"}</span></td>
                        <td className="whitespace-nowrap">{indianDay(row.business_date)}<span className="block text-[11.5px] text-muted-foreground">{shiftLabel(row.shift_code)}</span></td>
                        <td className="num">{Number(row.accepted || 0).toLocaleString("en-IN")} <span className="text-[11px] text-muted-foreground">{row.unit || ""}</span></td>
                        <td>
                          <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-signal-amber-line bg-signal-amber-soft px-2 py-0.5 text-[11.5px] font-semibold text-signal-amber-ink"><ClipboardList className="h-3 w-3" aria-hidden="true" />{waitingState(row)}</span>
                          <span className="mt-0.5 block text-[12px] tabular-nums text-foreground">{missingText(row)}</span>
                        </td>
                        <td className="whitespace-nowrap text-[12.5px] text-muted-foreground">{waitingFor(row.created_at)}</td>
                        <td className="text-right">{canLog ? <Link href={logQcHref(row.job_card_id, row.stage)} className="erp-btn-primary !h-9 whitespace-nowrap" data-testid="qc-waiting-log">Log QC</Link> : <Link href={`/production/job-cards/${row.job_card_id}`} className="erp-btn-secondary !h-9">View</Link>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              </>
            ) : (
              <div className="px-6 py-10 text-center" data-testid="qc-waiting-empty">
                <ClipboardCheck className="mx-auto mb-2 h-7 w-7 text-signal-emerald-ink" aria-hidden="true" />
                <p className="font-semibold">{rows.length ? "No run matches" : "Every run on the floor has its QC"}</p>
                <p className="mt-1 text-[12.5px] text-muted-foreground">New runs appear here as soon as the floor saves them.</p>
              </div>
            )}
          </Section>
        </>
      )}
    </div>
  )
}
