"use client"

// Issue history (client 2026-10-30): every issue to the floor from both issue desks — reels and coils, parchment
// by kg, adhesive and packing lots — with business date, time, shift (from the clock by the shift rule), material,
// reel / lot, quantity, where it went, who issued it and the rack it was picked from. Filters and CSV.
// Query: ?from=YYYY-MM-DD&to=YYYY-MM-DD&item=<text> (the stock book links here with a month and a material).

import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Suspense, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { BookOpenCheck, Download, History, MapPin, PackageCheck, RotateCcw, Search } from "lucide-react"

import { Field, MessageBar, ProcurementShell, WorkPanel, fieldClass, secondaryButton } from "@/components/procurement/procurement-shell"
import { IssueDeskTabs } from "@/components/procurement/issue-desk-tabs"
import { RoleGate } from "@/components/workspace/role-gate"
import { useAuth } from "@/context/AuthContext"
import { usePeopleVersion } from "@/hooks/use-people"
import { csvCell, issueHistoryApi, type IssueHistoryFilters, type IssueHistoryRow } from "@/lib/api-issue-history"
import { shiftAt } from "@/lib/shift"
import { dayText, errorText, pickFromText, qtyText, who } from "@/lib/stock-format"
import { cn } from "@/lib/utils"

const ISO = /^\d{4}-\d{2}-\d{2}$/
const minusDays = (day: string, days: number) => {
  const [y, m, d] = day.split("-").map(Number)
  const value = new Date(Date.UTC(y, m - 1, d - days))
  return value.toISOString().slice(0, 10)
}
/** IST clock time of a naive-UTC registration stamp: "21:45". */
const istTime = (value?: string | null) => {
  if (!value) return ""
  const date = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value}Z`)
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false })
}
const shiftName = (row: IssueHistoryRow) => {
  const code = String(row.shift || "").toUpperCase()
  return code === "A" || code === "B" ? `Shift ${code}` : code === "GENERAL" ? "General (older)" : code ? code : "—"
}

export default function IssueHistoryPage() {
  return (
    <Suspense fallback={null}>
      <IssueHistory />
    </Suspense>
  )
}

function IssueHistory() {
  usePeopleVersion()
  const { activePlant } = useAuth()
  const search = useSearchParams()
  const today = shiftAt().businessDate
  const linkedTo = ISO.test(search?.get("to") || "") ? String(search?.get("to")) : today
  const linkedFrom = ISO.test(search?.get("from") || "") ? String(search?.get("from")) : minusDays(linkedTo, 6)
  const [draft, setDraft] = useState<IssueHistoryFilters>({ date_from: linkedFrom, date_to: linkedTo, shift: "", kind: "ALL", item: search?.get("item") || "", card: "", person: "" })
  const [filters, setFilters] = useState<IssueHistoryFilters>(draft)
  const query = useQuery({
    // Under the reel-issue key, so an issue on either desk refreshes this list too.
    queryKey: ["inventory-reel-issues", "history", activePlant || "none", filters],
    queryFn: () => issueHistoryApi.list(filters),
  })
  const rows = useMemo(() => query.data?.rows || [], [query.data])
  const set = (patch: Partial<IssueHistoryFilters>) => setDraft((current) => ({ ...current, ...patch }))
  const apply = (next: IssueHistoryFilters = draft) => setFilters({ ...next })
  const reset = () => { const fresh = { date_from: minusDays(today, 6), date_to: today, shift: "", kind: "ALL" as const, item: "", card: "", person: "" }; setDraft(fresh); setFilters(fresh) }
  const quick = (from: string, to: string) => { const next = { ...draft, date_from: from, date_to: to }; setDraft(next); apply(next) }
  const month = String(filters.date_to || today).slice(0, 7)

  function exportCsv() {
    const header = ["Business date", "Time (IST)", "Shift", "Material code", "Material", "Reel / lot", "Kind", "Quantity", "Unit", "Went to", "Card", "Issued by", "Picked from rack", "Note"]
    const body = rows.map((row) => [
      row.day || "", istTime(row.issued_at), shiftName(row), row.item_code, row.item_name, row.lot || "", row.lot_kind,
      String(row.qty), row.uom, row.to, row.card_label || "", row.issued_by ? who(row.issued_by) : "Not recorded",
      row.from_location ? `${row.from_location.name} (${row.from_location.code})` : "", row.note || "",
    ])
    const text = [header, ...body].map((line) => line.map(csvCell).join(",")).join("\r\n")
    const blob = new Blob([`﻿${text}`], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `issue-history-${filters.date_from}-to-${filters.date_to}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <RoleGate allow={["Store", "PlantManager", "RMIssue", "Planner", "GRN"]}>
      <ProcurementShell
        eyebrow="Stores"
        title="Issue history"
        description="Every issue to the floor from both desks. The date is the shift's business day (Shift A 08:00–20:00, Shift B 20:00–08:00 next morning), taken from the clock when the issue was registered. These are the quantities the stock book counts as Issued."
        actions={<IssueDeskTabs />}
        allPlants
      >
        <WorkPanel title="Filters" description="Dates are business days. Item matches the material code or name, or the reel / lot number.">
          <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" onSubmit={(event) => { event.preventDefault(); apply() }} data-testid="issue-history-filters">
            <Field label="From"><input type="date" className={cn(fieldClass, "max-sm:h-11")} value={draft.date_from} max={draft.date_to || today} onChange={(e) => set({ date_from: e.target.value })} data-testid="issue-history-from" /></Field>
            <Field label="To"><input type="date" className={cn(fieldClass, "max-sm:h-11")} value={draft.date_to} min={draft.date_from} max={today} onChange={(e) => set({ date_to: e.target.value })} data-testid="issue-history-to" /></Field>
            <Field label="Shift">
              <select className={cn(fieldClass, "max-sm:h-11")} value={draft.shift} onChange={(e) => set({ shift: e.target.value })} data-testid="issue-history-shift">
                <option value="">Both shifts</option><option value="A">Shift A (08:00–20:00)</option><option value="B">Shift B (20:00–08:00)</option><option value="GENERAL">General (older issues)</option>
              </select>
            </Field>
            <Field label="Kind">
              <select className={cn(fieldClass, "max-sm:h-11")} value={draft.kind} onChange={(e) => set({ kind: e.target.value as IssueHistoryFilters["kind"] })} data-testid="issue-history-kind">
                <option value="ALL">Everything</option><option value="REEL">Paper reels & coils</option><option value="MATERIAL">Adhesive, parchment, packing</option>
              </select>
            </Field>
            <Field label="Item"><input className={cn(fieldClass, "max-sm:h-11")} value={draft.item} placeholder="Material, AT or lot number" onChange={(e) => set({ item: e.target.value })} data-testid="issue-history-item" /></Field>
            <Field label="Card"><input className={cn(fieldClass, "max-sm:h-11")} value={draft.card} placeholder="Job card (older issues)" onChange={(e) => set({ card: e.target.value })} data-testid="issue-history-card" /></Field>
            <Field label="Issued by">
              <select className={cn(fieldClass, "max-sm:h-11")} value={draft.person} onChange={(e) => set({ person: e.target.value })} data-testid="issue-history-person">
                <option value="">Anyone</option>
                {(query.data?.people || []).map((person) => <option key={person} value={person}>{who(person)}</option>)}
              </select>
            </Field>
            <div className="flex items-end gap-2">
              <button type="submit" className="erp-btn-primary max-sm:h-11 flex-1 justify-center" data-testid="issue-history-apply"><Search className="h-4 w-4" aria-hidden="true" />Show</button>
              <button type="button" className={secondaryButton} onClick={reset} title="Last 7 days, everything"><RotateCcw className="h-4 w-4" aria-hidden="true" /><span className="sr-only">Reset</span></button>
            </div>
          </form>
          <div className="mt-3 flex flex-wrap gap-2 text-[12.5px]">
            {[["Today", today, today], ["Last 7 days", minusDays(today, 6), today], ["This month", `${today.slice(0, 7)}-01`, today]].map(([label, from, to]) => (
              <button key={label} type="button" onClick={() => quick(from, to)} className={cn("min-h-11 rounded-full border px-3 font-semibold sm:min-h-8", filters.date_from === from && filters.date_to === to ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground")}>{label}</button>
            ))}
          </div>
        </WorkPanel>

        {query.isError ? <MessageBar tone="error">Issue history could not load: {errorText(query.error)}</MessageBar> : null}

        <div className="grid gap-3 sm:grid-cols-3" data-testid="issue-history-totals">
          <div className="rounded-xl border border-border bg-card px-4 py-3">
            <p className="text-[12px] font-medium text-muted-foreground">Issues</p>
            <p className="text-[22px] font-semibold tabular-nums">{query.data ? query.data.count : "…"}</p>
            <p className="truncate text-[11.5px] text-muted-foreground">{dayText(filters.date_from)} – {dayText(filters.date_to)}</p>
          </div>
          <div className="rounded-xl border border-border bg-card px-4 py-3 sm:col-span-2">
            <p className="text-[12px] font-medium text-muted-foreground">Issued</p>
            <p className="text-[18px] font-semibold tabular-nums">{query.data?.totals.length ? query.data.totals.map((row) => qtyText(row.qty, row.uom as any)).join(" · ") : "—"}</p>
            <Link href={`/inventory/stock-control?tab=book&month=${month}`} className="mt-0.5 inline-flex min-h-11 items-center gap-1 text-[12.5px] font-semibold text-primary hover:underline sm:min-h-0" data-testid="issue-history-book-link"><BookOpenCheck className="h-3.5 w-3.5" aria-hidden="true" />Same figures in the stock book, Issued</Link>
          </div>
        </div>

        <WorkPanel
          title={`Issues · ${rows.length}${query.data?.truncated ? "+" : ""}`}
          description="Newest first. Time is when the issue was registered (India time)."
          action={<button type="button" className={secondaryButton} onClick={exportCsv} disabled={!rows.length} data-testid="issue-history-csv"><Download className="h-4 w-4" aria-hidden="true" />CSV</button>}
        >
          {query.data?.truncated ? <MessageBar tone="info">Only the newest {rows.length} issues are shown. Narrow the dates to see the rest.</MessageBar> : null}
          {query.isLoading ? <p className="py-6 text-center text-sm text-muted-foreground">Loading issues…</p> : rows.length ? (
            <div className="overflow-x-auto" data-testid="issue-history-table">
              <table className="tube-grid w-full min-w-[980px] !text-[13px]">
                <thead><tr><th>Date · time</th><th>Shift</th><th>Material</th><th>Reel / lot</th><th className="num">Quantity</th><th>Went to</th><th>Issued by</th><th>Picked from</th></tr></thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} data-testid="issue-history-row">
                      <td className="whitespace-nowrap">{dayText(row.day)}<span className="block text-[12px] text-muted-foreground">{istTime(row.issued_at) || "—"}</span></td>
                      <td className="whitespace-nowrap font-medium">{shiftName(row)}</td>
                      <td><span className="font-medium">{row.item_name}</span><span className="block text-[12px] text-muted-foreground">{row.item_code}</span></td>
                      <td className="whitespace-nowrap"><span className="font-mono font-semibold">{row.lot || "—"}</span><span className="block text-[12px] text-muted-foreground">{row.lot_kind}{row.vendor_reel_no ? ` · vendor ${row.vendor_reel_no}` : ""}</span></td>
                      <td className="num whitespace-nowrap font-semibold tabular-nums">{qtyText(row.qty, row.uom as any)}</td>
                      <td>{row.to}{row.card_label ? <span className="block text-[12px] text-muted-foreground">{row.card_label}</span> : null}{row.note ? <span className="block text-[12px] text-muted-foreground">{row.note}</span> : null}</td>
                      <td>{row.issued_by ? who(row.issued_by) : <span className="text-muted-foreground">Not recorded</span>}</td>
                      <td>{row.from_location ? <span className="inline-flex items-start gap-1"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />{pickFromText(row.from_location).replace(/^Pick from /, "")}</span> : <span className="text-muted-foreground">No rack</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border p-6 text-center text-[13px] text-muted-foreground" data-testid="issue-history-empty">
              <History className="mx-auto mb-2 h-6 w-6" aria-hidden="true" />
              No issue matches these filters.
              <span className="mt-3 flex flex-wrap justify-center gap-2">
                <Link href="/inventory/reels/issue" className={secondaryButton}><PackageCheck className="h-4 w-4" aria-hidden="true" />Reel & coil issue</Link>
                <Link href="/inventory/production-issue" className={secondaryButton}><PackageCheck className="h-4 w-4" aria-hidden="true" />Material issue</Link>
              </span>
            </div>
          )}
        </WorkPanel>
      </ProcurementShell>
    </RoleGate>
  )
}
