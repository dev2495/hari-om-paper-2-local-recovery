"use client"

import Link from "next/link"
import dayjs from "dayjs"
import utc from "dayjs/plugin/utc"
import { useMemo, useState } from "react"

import { EmptyState, Panel } from "@/components/erp/shell"
import { useMachines, useStageTimeReconciliation } from "@/hooks/use-production"

dayjs.extend(utc)

const PAGE_SIZE = 100
const STAGES = ["", "SLITTING", "WINDER", "OVEN", "PROCESS", "PACKING", "QC"]

// Backend timestamps are UTC; show them in the viewer's (plant) local time.
function localTime(value?: string | null) {
  if (!value) return "-"
  const parsed = dayjs.utc(value)
  return parsed.isValid() ? parsed.local().format("DD MMM HH:mm") : String(value)
}

function minutesLabel(value?: number | null) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "-"
  const total = Math.round(Number(value))
  const days = Math.floor(total / 1440)
  const hours = Math.floor((total % 1440) / 60)
  const minutes = total % 60
  return days ? `${days}d ${hours}h` : `${hours}h ${String(minutes).padStart(2, "0")}m`
}

function sourceLabel(value?: string) {
  if (value === "CARD") return "Card time"
  if (value === "SYSTEM_ENTRY") return "No card time (override)"
  return "Legacy"
}

export default function StageTimeReconciliationPage() {
  const [dateFrom, setDateFrom] = useState(dayjs().subtract(7, "day").format("YYYY-MM-DD"))
  const [dateTo, setDateTo] = useState(dayjs().format("YYYY-MM-DD"))
  const [stage, setStage] = useState("")
  const [lateOnly, setLateOnly] = useState(false)
  const [offset, setOffset] = useState(0)
  const machinesQuery = useMachines()

  const params = useMemo(
    () => ({
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
      stage: stage || undefined,
      late_only: lateOnly || undefined,
      limit: PAGE_SIZE,
      offset,
    }),
    [dateFrom, dateTo, stage, lateOnly, offset],
  )
  const query = useStageTimeReconciliation(params)
  const rows: any[] = Array.isArray(query.data?.items) ? query.data.items : []
  const total = Number(query.data?.total || 0)
  const thresholdHours = Number(query.data?.late_threshold_hours || 6)
  const machineLabelMap = useMemo(
    () =>
      new Map(
        (Array.isArray(machinesQuery.data) ? machinesQuery.data : []).map((machine: any) => [
          String(machine.id),
          machine.code || machine.name || String(machine.id).slice(0, 8),
        ]),
      ),
    [machinesQuery.data],
  )
  const lateCount = rows.filter((row) => row.late_entry).length
  const noCardTime = rows.filter((row) => row.time_source !== "CARD").length

  const resetPage = <T,>(setter: (value: T) => void) => (value: T) => {
    setter(value)
    setOffset(0)
  }

  return (
    <div className="space-y-5">
      <Panel
        title="Card time reconciliation"
        subtitle={`Start (A) / End (B) written on the paper job card vs. when it was typed into the ERP. Entries more than ${thresholdHours} h after the card time are flagged late.`}
        actions={
          <Link href="/production/job-cards" className="rounded-xl border border-input px-3 py-2 text-sm font-semibold text-foreground">
            Back to job cards
          </Link>
        }
      >
        <div className="flex flex-wrap items-end gap-3 text-sm">
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-semibold text-muted-foreground">Entered from</span>
            <input type="date" value={dateFrom} onChange={(event) => resetPage(setDateFrom)(event.target.value)} className="rounded-lg border border-input px-3 py-2" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-semibold text-muted-foreground">Entered to</span>
            <input type="date" value={dateTo} onChange={(event) => resetPage(setDateTo)(event.target.value)} className="rounded-lg border border-input px-3 py-2" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-semibold text-muted-foreground">Stage</span>
            <select value={stage} onChange={(event) => resetPage(setStage)(event.target.value)} className="rounded-lg border border-input px-3 py-2">
              {STAGES.map((value) => (
                <option key={value || "all"} value={value}>
                  {value || "All stages"}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 pb-2">
            <input type="checkbox" checked={lateOnly} onChange={(event) => resetPage(setLateOnly)(event.target.checked)} />
            <span className="font-semibold text-foreground">Late entries only</span>
          </label>
          <div className="ml-auto flex gap-4 pb-2 text-muted-foreground">
            <span>
              Rows <strong className="text-foreground">{total}</strong>
            </span>
            <span>
              Late on page <strong className="text-signal-amber-ink">{lateCount}</strong>
            </span>
            <span>
              Without card time <strong className="text-signal-rose-ink">{noCardTime}</strong>
            </span>
          </div>
        </div>
      </Panel>

      <Panel title="Stage entries" subtitle="Newest entry first. Card times drive cycle time, capacity buckets and reports; entry time is kept for audit.">
        {query.isLoading ? (
          <div className="py-8 text-sm text-muted-foreground">Loading entries…</div>
        ) : query.isError ? (
          <div className="rounded-xl border border-signal-rose-line bg-signal-rose-soft px-4 py-3 text-sm text-signal-rose-ink">Unable to load time reconciliation.</div>
        ) : rows.length === 0 ? (
          <EmptyState label="No stage entries were typed in for the selected window." />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-[12px] text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Job card</th>
                  <th className="px-3 py-2">Stage</th>
                  <th className="px-3 py-2">Machine / shift</th>
                  <th className="px-3 py-2">Card start (A)</th>
                  <th className="px-3 py-2">Card end (B)</th>
                  <th className="px-3 py-2">Cycle</th>
                  <th className="px-3 py-2">Entered</th>
                  <th className="px-3 py-2">Lag</th>
                  <th className="px-3 py-2">Source</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.job_card_id}-${row.stage_type}`} className={`border-t border-border ${row.late_entry ? "bg-signal-amber-soft" : ""}`}>
                    <td className="px-3 py-2">
                      <Link href={`/production/job-cards/${row.job_card_id}`} className="font-semibold text-signal-cyan-ink hover:underline">
                        {row.job_card_ref}
                      </Link>
                      <div className="text-xs text-muted-foreground">{row.customer_name || "-"}</div>
                    </td>
                    <td className="px-3 py-2 font-semibold">{row.stage_type}</td>
                    <td className="px-3 py-2">
                      {row.machine_id ? machineLabelMap.get(String(row.machine_id)) || String(row.machine_id).slice(0, 8) : "-"}
                      <div className="text-xs text-muted-foreground">
                        {String(row.card_shift_code || row.shift_code || "-").replace("_", " ")}
                        {row.card_shift_code && row.shift_code && row.card_shift_code !== row.shift_code ? ` (planned ${row.shift_code.replace("_", " ")})` : ""}
                      </div>
                    </td>
                    <td className="px-3 py-2">{localTime(row.card_start_time)}</td>
                    <td className="px-3 py-2">{localTime(row.card_end_time)}</td>
                    <td className="px-3 py-2">{minutesLabel(row.cycle_time_minutes)}</td>
                    <td className="px-3 py-2">
                      {localTime(row.entered_at)}
                      <div className="text-xs text-muted-foreground">{row.entered_by || ""}</div>
                    </td>
                    <td className={`px-3 py-2 font-semibold ${row.late_entry ? "text-signal-amber-ink" : "text-foreground"}`}>{minutesLabel(row.entry_lag_minutes)}</td>
                    <td className={`px-3 py-2 ${row.time_source === "CARD" ? "text-muted-foreground" : "font-semibold text-signal-rose-ink"}`}>{sourceLabel(row.time_source)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
              <span>
                {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
              </span>
              <div className="flex gap-2">
                <button type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} className="rounded-lg border border-input px-3 py-1 disabled:opacity-40">
                  Previous
                </button>
                <button type="button" disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)} className="rounded-lg border border-input px-3 py-1 disabled:opacity-40">
                  Next
                </button>
              </div>
            </div>
          </div>
        )}
      </Panel>
    </div>
  )
}
