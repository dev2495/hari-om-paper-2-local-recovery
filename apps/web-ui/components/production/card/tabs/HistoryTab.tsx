"use client"

// History & audit: one time-ordered list of plain events for the card — released, planned, runs logged /
// edited / voided, QC and flags, holds, stage closes, splits, edits, dispatch — who, when, before → after.

import { CalendarRange, CheckCircle2, Download, Flag, ListChecks, Pencil, Scissors, Search, Truck, X } from "lucide-react"
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { describeApiError } from "@/lib/api-error"
import { useCardHistory } from "../data"
import { stampLabel, toneClass } from "../model"

const GROUPS: Array<{ key: string; label: string; kinds: string[] }> = [
  { key: "ALL", label: "All", kinds: [] },
  { key: "RUNS", label: "Output", kinds: ["RUN", "RUN_EDIT", "RUN_VOID"] },
  { key: "QC", label: "QC", kinds: ["QC", "QC_FLAG", "HOLD"] },
  { key: "PLAN", label: "Planning", kinds: ["PLAN"] },
  { key: "STAGES", label: "Stages", kinds: ["STAGE_CLOSE", "STAGE_REOPEN"] },
  { key: "CARD", label: "Card", kinds: ["RELEASE", "SPLIT", "EDIT", "FORCE_CLOSE"] },
  { key: "DISPATCH", label: "Dispatch", kinds: ["DISPATCH"] },
  { key: "OTHER", label: "Other", kinds: ["OTHER"] },
]
const KIND_ICON: Record<string, any> = { RUN: ListChecks, RUN_EDIT: Pencil, RUN_VOID: X, QC: CheckCircle2, QC_FLAG: Flag, HOLD: Flag, PLAN: CalendarRange, STAGE_CLOSE: CheckCircle2, STAGE_REOPEN: Pencil, RELEASE: ListChecks, SPLIT: Scissors, EDIT: Pencil, FORCE_CLOSE: X, DISPATCH: Truck }
const KIND_TONE: Record<string, "emerald" | "amber" | "rose" | "blue" | "violet" | "muted"> = { RUN: "emerald", RUN_EDIT: "rose", RUN_VOID: "rose", QC: "amber", QC_FLAG: "amber", HOLD: "rose", PLAN: "blue", STAGE_CLOSE: "emerald", STAGE_REOPEN: "rose", RELEASE: "blue", SPLIT: "violet", EDIT: "violet", FORCE_CLOSE: "rose", DISPATCH: "blue", OTHER: "muted" }
const groupOf = (kind: string) => GROUPS.find((g) => g.kinds.includes(kind))?.key || "OTHER"
const dayKey = (at: string) => {
  const text = String(at || "")
  const date = new Date(/(?:Z|[+-]\d{2}:\d{2})$/i.test(text) ? text : `${text}Z`)
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("en-CA")
}
const dayHeading = (key: string) => {
  const today = new Date().toLocaleDateString("en-CA")
  const y = new Date()
  y.setDate(y.getDate() - 1)
  const label = key ? new Date(`${key}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "Undated"
  return key === today ? `Today · ${label}` : key === y.toLocaleDateString("en-CA") ? `Yesterday · ${label}` : label
}
const text = (value: any) => (value == null ? "" : typeof value === "string" ? value : typeof value === "object" ? Object.entries(value).map(([k, v]) => `${k} ${v}`).join(", ") : String(value))

export function HistoryTab({ card }: { card: any }) {
  const history = useCardHistory(card)
  const [group, setGroup] = useState("ALL")
  const [search, setSearch] = useState("")
  const [flaggedFirst, setFlaggedFirst] = useState(false)
  const [exporting, setExporting] = useState(false)
  const events: any[] = useMemo(() => history.data?.events || [], [history.data])
  const counts = useMemo(() => {
    const by: Record<string, number> = { ALL: events.length }
    for (const e of events) by[groupOf(e.kind)] = (by[groupOf(e.kind)] || 0) + 1
    return by
  }, [events])
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = events.filter((e) => (group === "ALL" || groupOf(e.kind) === group) && (!q || [e.title, e.detail, e.actor, e.role, e.stage_label, e.job_card_no, e.kind].some((v) => String(v || "").toLowerCase().includes(q))))
    return flaggedFirst ? [...list.filter((e) => e.flag), ...list.filter((e) => !e.flag)] : list
  }, [events, group, search, flaggedFirst])
  const grouped = useMemo(() => {
    const out: Array<{ key: string; rows: any[] }> = []
    for (const e of shown) {
      const key = flaggedFirst ? (e.flag ? "flagged" : dayKey(e.at)) : dayKey(e.at)
      const last = out[out.length - 1]
      if (last && last.key === key) last.rows.push(e)
      else out.push({ key, rows: [e] })
    }
    return out
  }, [shown, flaggedFirst])

  const exportExcel = async () => {
    setExporting(true)
    try {
      const ExcelJS = await import("exceljs")
      const workbook = new ExcelJS.Workbook()
      const sheet = workbook.addWorksheet("History")
      sheet.columns = [
        { header: "When", key: "at", width: 20 },
        { header: "Who", key: "actor", width: 22 },
        { header: "Role", key: "role", width: 14 },
        { header: "Kind", key: "kind", width: 14 },
        { header: "Stage", key: "stage", width: 12 },
        { header: "What", key: "title", width: 44 },
        { header: "Detail", key: "detail", width: 60 },
        { header: "Flag", key: "flag", width: 8 },
        { header: "Before", key: "before", width: 30 },
        { header: "After", key: "after", width: 30 },
      ]
      sheet.getRow(1).font = { bold: true }
      for (const e of shown) sheet.addRow({ at: stampLabel(e.at), actor: e.actor || "", role: e.role || "", kind: e.kind, stage: e.stage_label || "", title: e.title || "", detail: text(e.detail), flag: e.flag ? "yes" : "", before: text(e.before), after: text(e.after) })
      const blob = new Blob([await workbook.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = `job-card-${String(card?.job_card_no || card?.id || "history").replace(/[^\w-]+/g, "-")}-history.xlsx`
      link.click()
      URL.revokeObjectURL(url)
    } finally {
      setExporting(false)
    }
  }

  return (
    <section className="rounded-xl border border-border bg-card" data-testid="tab-history">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <h3 className="text-[14px] font-semibold">History &amp; audit</h3>
        <span className="hidden text-[12px] text-muted-foreground sm:inline">released, planned, runs logged / edited / voided, QC and flags, holds, closes, splits, edits, dispatch — who, when, before → after</span>
        <Button size="sm" variant="outline" className="ml-auto" disabled={exporting || !shown.length} onClick={() => void exportExcel()} data-testid="history-export">
          <Download className="h-3.5 w-3.5" /> {exporting ? "Exporting…" : "Export"}
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Kind">
          {GROUPS.filter((g) => g.key === "ALL" || counts[g.key]).map((g) => (
            <button key={g.key} type="button" aria-pressed={group === g.key} onClick={() => setGroup(g.key)} className={cn("inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-medium transition", group === g.key ? "border-foreground bg-foreground text-background" : "border-border bg-card hover:bg-muted")} data-testid={`history-chip-${g.key.toLowerCase()}`}>
              {g.label}
              <span className={cn("rounded-full px-1.5 text-[11px] tabular-nums", group === g.key ? "bg-background/20" : "bg-muted text-muted-foreground")}>{counts[g.key] || 0}</span>
            </button>
          ))}
        </div>
        <label className="ml-auto flex h-8 min-w-[12rem] items-center gap-2 rounded-lg border border-border bg-card px-2.5 text-[12.5px]">
          <Search className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search who, what, stage…" aria-label="Search history" className="min-w-0 flex-1 bg-transparent outline-none" data-testid="history-search" />
        </label>
        <label className="flex h-8 items-center gap-1.5 text-[12.5px]">
          <input type="checkbox" checked={flaggedFirst} onChange={(e) => setFlaggedFirst(e.target.checked)} data-testid="history-flagged-first" /> Flagged first
        </label>
      </div>
      <div className="px-4 py-3">
        {history.isLoading ? <p className="py-6 text-center text-[13px] text-muted-foreground">Loading the card&apos;s history…</p> : null}
        {history.isError ? <p role="alert" className="py-6 text-center text-[13px] text-signal-rose-ink">History could not be loaded: {describeApiError(history.error, "try again")}.</p> : null}
        {history.isSuccess && !shown.length ? <p className="py-6 text-center text-[13px] text-muted-foreground">{events.length ? "Nothing matches this filter." : "No events on this card yet."}</p> : null}
        {grouped.map((day) => (
          <div key={day.key || "undated"} className="mb-3">
            <p className="sticky top-0 z-[1] bg-card py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{day.key === "flagged" ? "Flagged" : dayHeading(day.key)}</p>
            <ol className="relative ml-3 border-l border-border pl-5">
              {day.rows.map((e) => {
                const Icon = KIND_ICON[e.kind] || ListChecks
                const tone = e.flag ? "amber" : KIND_TONE[e.kind] || "muted"
                return (
                  <li key={e.id} className="relative py-2" data-testid={`history-event-${e.kind.toLowerCase()}`}>
                    <span className={cn("absolute -left-[1.95rem] top-2 grid h-6 w-6 place-items-center rounded-full border", toneClass(tone))}>
                      <Icon className="h-3 w-3" aria-hidden="true" />
                    </span>
                    <div className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
                      <span className="w-[8.5rem] shrink-0 tabular-nums text-muted-foreground">{stampLabel(e.at)}</span>
                      <span className="font-semibold">{String(e.actor || "—").split("@")[0]}</span>
                      {e.role ? <span className="text-muted-foreground">· {e.role}</span> : null}
                      {e.stage_label ? <span className="rounded-full border border-border bg-muted px-1.5 text-[11px] font-medium text-muted-foreground">{e.stage_label}</span> : null}
                      {e.job_card_no && e.job_card_no !== card?.job_card_no ? <span className="text-[11px] text-muted-foreground">{e.job_card_no}</span> : null}
                      {e.flag ? (
                        <span className={cn("inline-flex items-center gap-1 rounded-full border px-1.5 text-[11px] font-semibold", toneClass("amber"))}>
                          <Flag className="h-2.5 w-2.5" aria-hidden="true" /> flagged
                        </span>
                      ) : null}
                    </div>
                    <p className="text-[13.5px] sm:ml-[9rem]">{e.title}</p>
                    {e.detail ? <p className="text-[12.5px] text-muted-foreground sm:ml-[9rem]">{text(e.detail)}</p> : null}
                    {e.before != null || e.after != null ? (
                      <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px] sm:ml-[9rem]">
                        {e.before != null ? <span className="rounded bg-signal-rose-soft px-1.5 py-0.5 text-signal-rose-ink line-through">{text(e.before)}</span> : null}
                        {e.before != null && e.after != null ? <span className="text-muted-foreground">→</span> : null}
                        {e.after != null ? <span className="rounded bg-signal-emerald-soft px-1.5 py-0.5 text-signal-emerald-ink">{text(e.after)}</span> : null}
                      </p>
                    ) : null}
                  </li>
                )
              })}
            </ol>
          </div>
        ))}
      </div>
    </section>
  )
}
