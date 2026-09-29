"use client"

import dayjs from "dayjs"
import { useEffect, useMemo, useRef, useState } from "react"
import { AlertTriangle, CheckCheck, CheckCircle2, Download, Printer, RefreshCw, Save, Search, ShieldCheck } from "lucide-react"

import { cn } from "@/lib/utils"

type Line = {
  id: string; item_id: string; item_code: string; item_name: string; item_type: string; tracking_mode: string; uom: string
  closing_qty: number; physical_qty: number; live_qty?: number; unit_cost: number; count_state: string; counted?: boolean
  recount_required?: boolean; bin_code?: string | null; checked_by?: string | null
}
type Draft = { qty?: string; bin?: string; recount?: boolean }
type Filter = "all" | "todo" | "counted" | "variance" | "recount"

const fmt = (value: number, digits = 2) => Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: digits })
const money = (value: number) => `₹${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`
const TYPE_LABEL: Record<string, string> = { RAW_PAPER: "Paper", ADHESIVE: "Adhesive", PARCHMENT: "Parchment", PACKAGING: "Packing", FINISHED_GOOD: "Finished", TOOL: "Tool", OTHER: "Other" }

/**
 * The physical count: every active material, its book stock at the count time and live stock
 * now, the counted quantity, and the variance. A line is "counted" only when someone enters a
 * quantity (or marks it as matching book) — pre-filled book numbers never pass as a count.
 */
export function CountSheet({ certification, editable, busy, onSave, onRefresh, onCertify }: {
  certification: any
  editable: boolean
  busy: { save: boolean; refresh: boolean; certify: boolean }
  onSave: (lines: Array<{ line_id: string; physical_qty: number; bin_code?: string; recount_required?: boolean; count_state?: string }>) => Promise<unknown>
  onRefresh: () => Promise<unknown>
  onCertify: () => Promise<unknown>
}) {
  const lines: Line[] = useMemo(() => (Array.isArray(certification?.lines) ? certification.lines : []), [certification?.lines])
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [filter, setFilter] = useState<Filter>("all")
  const [type, setType] = useState("all")
  const [search, setSearch] = useState("")
  const inputs = useRef<Record<string, HTMLInputElement | null>>({})
  const [error, setError] = useState("")
  const run = async (action: () => Promise<unknown>) => {
    setError("")
    try { await action(); return true } catch (err: any) {
      const detail = err?.response?.data?.detail
      setError(typeof detail === "string" ? detail : detail?.message || err?.message || "That did not go through. Try again.")
      return false
    }
  }
  useEffect(() => { setDrafts({}) }, [certification?.id, certification?.stock_as_of_at])

  const isCounted = (line: Line) => drafts[line.id]?.qty !== undefined ? drafts[line.id]!.qty !== "" : Boolean(line.counted ?? ["COUNTED", "REVIEWED"].includes(String(line.count_state).toUpperCase()))
  const countedQty = (line: Line) => (drafts[line.id]?.qty !== undefined && drafts[line.id]!.qty !== "" ? Number(drafts[line.id]!.qty) : Number(line.physical_qty ?? line.closing_qty))
  const variance = (line: Line) => (isCounted(line) ? countedQty(line) - Number(line.closing_qty || 0) : 0)
  const recount = (line: Line) => drafts[line.id]?.recount ?? Boolean(line.recount_required)

  const types = Array.from(new Set(lines.map((line) => line.item_type))).sort()
  const needle = search.trim().toLowerCase()
  const visible = lines.filter((line) => (type === "all" || line.item_type === type)
    && (!needle || `${line.item_code} ${line.item_name}`.toLowerCase().includes(needle))
    && (filter === "all" || (filter === "todo" && !isCounted(line)) || (filter === "counted" && isCounted(line)) || (filter === "variance" && Math.abs(variance(line)) > 0.0005) || (filter === "recount" && recount(line))))
  const counted = lines.filter(isCounted).length
  const varianceLines = lines.filter((line) => Math.abs(variance(line)) > 0.0005)
  const varianceValue = varianceLines.reduce((sum, line) => sum + variance(line) * Number(line.unit_cost || 0), 0)
  const touched = Object.keys(drafts).length
  const missing = Number(certification?.missing_item_count || 0)
  const moved = Number(certification?.moved_since_draft_count || 0)

  const setQty = (line: Line, qty: string) => setDrafts((current) => ({ ...current, [line.id]: { ...current[line.id], qty } }))
  const matchBook = (line: Line) => setQty(line, String(Number(line.closing_qty || 0)))
  const save = async () => {
    const payload = Object.entries(drafts).map(([id, draft]) => {
      const line = lines.find((row) => row.id === id)!
      const hasQty = draft.qty !== undefined && draft.qty !== ""
      return {
        line_id: id,
        physical_qty: hasQty ? Number(draft.qty) : Number(line.physical_qty ?? line.closing_qty),
        ...(draft.bin !== undefined ? { bin_code: draft.bin } : {}),
        ...(draft.recount !== undefined ? { recount_required: draft.recount } : {}),
        ...(hasQty ? {} : { count_state: line.count_state }),
      }
    })
    if (!payload.length) return
    if (await run(() => onSave(payload))) setDrafts({})
  }
  const exportCsv = () => {
    const rows = [["Item code", "Item", "Type", "UoM", "Book", "Live now", "Counted", "Variance", "Variance value", "Bin", "Status"]]
    for (const line of lines) rows.push([line.item_code, line.item_name, TYPE_LABEL[line.item_type] || line.item_type, line.uom, String(line.closing_qty), String(line.live_qty ?? ""), isCounted(line) ? String(countedQty(line)) : "", String(variance(line)), String(Math.round(variance(line) * Number(line.unit_cost || 0))), drafts[line.id]?.bin ?? line.bin_code ?? "", isCounted(line) ? "counted" : "not counted"])
    const blob = new Blob([rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n")], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `stock-count-${certification?.count_session_no || certification?.period_end || "sheet"}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }
  const focusNext = (index: number) => {
    const next = visible[index + 1]
    if (next) inputs.current[next.id]?.focus()
  }

  return (
    <section className="rounded-xl border border-border bg-card shadow-sm" data-testid="stock-count-sheet">
      <div className="flex flex-wrap items-start gap-3 border-b border-border p-4">
        <div className="min-w-0">
          <p className="text-[15px] font-semibold tracking-tight">Count sheet · {certification.count_session_no || `${certification.period_start} → ${certification.period_end}`}</p>
          <p className="text-[12.5px] text-muted-foreground">Book stock as of <strong className="text-foreground">{dayjs(certification.stock_as_of_at).format("DD MMM YYYY, HH:mm")}</strong> · status {String(certification.status).toLowerCase()}</p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button type="button" onClick={exportCsv} className="erp-btn-secondary !h-8"><Download className="h-3.5 w-3.5" />CSV</button>
          <button type="button" onClick={() => window.print()} className="erp-btn-secondary !h-8"><Printer className="h-3.5 w-3.5" />Print sheet</button>
          {editable ? (
            <>
              <button type="button" onClick={() => void run(onRefresh)} disabled={busy.refresh} className="erp-btn-secondary !h-8" title="Add items created since the draft and move book stock to now. Counts you entered are kept."><RefreshCw className={cn("h-3.5 w-3.5", busy.refresh && "animate-spin")} />Refresh to live</button>
              <button type="button" onClick={() => void save()} disabled={!touched || busy.save} className="erp-btn-primary !h-8" data-testid="count-sheet-save"><Save className="h-3.5 w-3.5" />{busy.save ? "Saving…" : `Save ${touched || ""} count${touched === 1 ? "" : "s"}`.replace("  ", " ")}</button>
              <button type="button" onClick={() => void run(onCertify)} disabled={busy.certify || counted < lines.length || touched > 0} title={counted < lines.length ? "Count every line first" : touched ? "Save your counts first" : "Certify the closing stock"} className="erp-btn-secondary !h-8"><ShieldCheck className="h-3.5 w-3.5" />Certify</button>
            </>
          ) : null}
        </div>
      </div>

      {error ? <p role="alert" className="mx-4 mt-3 rounded-lg border border-signal-rose-line bg-signal-rose-soft px-3 py-2 text-[12.5px] text-signal-rose-ink">{error}</p> : null}
      {editable && (missing > 0 || moved > 0) ? (
        <div className="mx-4 mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-signal-amber-line bg-signal-amber-soft px-3 py-2 text-[12.5px] text-signal-amber-ink" role="status">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{missing > 0 ? `${missing} material${missing === 1 ? "" : "s"} created since this sheet was drafted ${missing === 1 ? "is" : "are"} not on it. ` : ""}{moved > 0 ? `${moved} line${moved === 1 ? "" : "s"} moved in the ledger since the draft (live stock differs from book).` : ""}</span>
          <button type="button" onClick={() => void run(onRefresh)} disabled={busy.refresh} className="ml-auto font-semibold underline">Refresh to live</button>
        </div>
      ) : null}

      <div className="grid gap-3 p-4 sm:grid-cols-4">
        <div className="sm:col-span-2">
          <div className="flex items-baseline justify-between text-[12.5px]"><span className="font-semibold">Counted</span><span className="tabular-nums text-muted-foreground">{counted} of {lines.length}</span></div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-signal-emerald-ink/80 transition-[width] duration-500" style={{ width: `${lines.length ? (counted / lines.length) * 100 : 0}%` }} /></div>
        </div>
        <div className="rounded-lg bg-[hsl(var(--surface-2))] px-3 py-1.5"><p className="text-[11px] text-muted-foreground">Lines with variance</p><p className="text-[15px] font-semibold tabular-nums">{varianceLines.length}</p></div>
        <div className="rounded-lg bg-[hsl(var(--surface-2))] px-3 py-1.5"><p className="text-[11px] text-muted-foreground">Variance value</p><p className={cn("text-[15px] font-semibold tabular-nums", varianceValue < 0 ? "text-signal-rose-ink" : varianceValue > 0 ? "text-signal-amber-ink" : "")}>{money(varianceValue)}</p></div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-y border-border bg-[hsl(var(--surface-2))] px-4 py-2">
        <div className="tube-segment !h-8" role="group" aria-label="Show lines">
          {([["all", `All ${lines.length}`], ["todo", `Not counted ${lines.length - counted}`], ["counted", `Counted ${counted}`], ["variance", `Variance ${varianceLines.length}`], ["recount", "Recount"]] as Array<[Filter, string]>).map(([key, label]) => (
            <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</button>
          ))}
        </div>
        <select aria-label="Material type" value={type} onChange={(event) => setType(event.target.value)} className="h-8 rounded-lg border border-input bg-card px-2 text-[12.5px]">
          <option value="all">All materials</option>
          {types.map((value) => <option key={value} value={value}>{TYPE_LABEL[value] || value}</option>)}
        </select>
        <label className="flex h-8 min-w-[200px] flex-1 items-center gap-1.5 rounded-lg border border-input bg-card px-2">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input aria-label="Search materials" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Code or name" className="w-full bg-transparent text-[12.5px] outline-none" />
        </label>
        {editable && filter === "todo" && visible.length ? (
          <button type="button" onClick={() => visible.forEach(matchBook)} className="erp-btn-secondary !h-8" title="Counted and found equal to book stock"><CheckCheck className="h-3.5 w-3.5" />Mark {visible.length} as matching book</button>
        ) : null}
      </div>

      <div className="max-h-[70dvh] overflow-auto">
        <table className="w-full text-[13px]">
          <thead className="sticky top-0 z-10 bg-card text-left text-[11.5px] text-muted-foreground shadow-[0_1px_0_hsl(var(--border))]">
            <tr>
              <th className="px-4 py-2 font-semibold">Material</th>
              <th className="px-3 py-2 text-right font-semibold">Book</th>
              <th className="px-3 py-2 text-right font-semibold">Live now</th>
              <th className="px-3 py-2 text-right font-semibold">Counted</th>
              <th className="px-3 py-2 text-right font-semibold">Variance</th>
              <th className="px-3 py-2 font-semibold">Bin</th>
              <th className="px-3 py-2 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((line, index) => {
              const done = isCounted(line)
              const diff = variance(line)
              const liveDiff = line.live_qty !== undefined && Math.abs(Number(line.live_qty) - Number(line.closing_qty)) > 0.0005
              return (
                <tr key={line.id} className={cn("border-t border-border", !done && "bg-signal-amber-soft/20")}>
                  <td className="px-4 py-1.5">
                    <p className="font-semibold">{line.item_code}</p>
                    <p className="text-[11.5px] text-muted-foreground">{line.item_name} · {TYPE_LABEL[line.item_type] || line.item_type}{line.tracking_mode === "REEL" ? " · reels" : ""}</p>
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmt(line.closing_qty)} <span className="text-[11px] text-muted-foreground">{line.uom}</span></td>
                  <td className={cn("px-3 py-1.5 text-right tabular-nums", liveDiff ? "font-semibold text-signal-amber-ink" : "text-muted-foreground")} title={liveDiff ? "Stock moved since the book figure; refresh to count against live" : undefined}>{line.live_qty === undefined ? "—" : fmt(line.live_qty)}</td>
                  <td className="px-3 py-1.5 text-right">
                    {editable ? (
                      <span className="inline-flex items-center gap-1">
                        <input
                          ref={(element) => { inputs.current[line.id] = element }}
                          type="number"
                          step="0.001"
                          aria-label={`${line.item_code} counted ${line.uom}`}
                          placeholder={done ? undefined : fmt(line.closing_qty)}
                          value={drafts[line.id]?.qty ?? (done ? String(line.physical_qty) : "")}
                          onChange={(event) => setQty(line, event.target.value)}
                          onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); focusNext(index) } }}
                          className={cn("h-8 w-28 rounded-md border bg-card px-2 text-right font-semibold tabular-nums", done ? "border-input" : "border-signal-amber-line")}
                        />
                        {!done ? <button type="button" onClick={() => matchBook(line)} title="Counted — same as book" className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-signal-emerald-soft hover:text-signal-emerald-ink"><CheckCircle2 className="h-4 w-4" /></button> : null}
                      </span>
                    ) : <span className="font-semibold tabular-nums">{done ? fmt(countedQty(line)) : "—"}</span>}
                  </td>
                  <td className={cn("px-3 py-1.5 text-right tabular-nums", !done ? "text-muted-foreground" : Math.abs(diff) <= 0.0005 ? "text-signal-emerald-ink" : diff < 0 ? "font-semibold text-signal-rose-ink" : "font-semibold text-signal-amber-ink")}>
                    {done ? `${diff > 0 ? "+" : ""}${fmt(diff)}` : "—"}
                    {done && Math.abs(diff) > 0.0005 ? <span className="block text-[11px] font-normal">{money(diff * Number(line.unit_cost || 0))}</span> : null}
                  </td>
                  <td className="px-3 py-1.5">
                    {editable ? <input aria-label={`${line.item_code} bin`} value={drafts[line.id]?.bin ?? line.bin_code ?? ""} onChange={(event) => setDrafts((current) => ({ ...current, [line.id]: { ...current[line.id], bin: event.target.value } }))} className="h-8 w-24 rounded-md border border-input bg-card px-2 text-[12.5px]" placeholder="Bin" /> : line.bin_code || "—"}
                  </td>
                  <td className="px-3 py-1.5 text-[12px]">
                    <span className={cn("font-semibold", done ? "text-signal-emerald-ink" : "text-signal-amber-ink")}>{done ? "Counted" : "Not counted"}</span>
                    {editable ? (
                      <label className="ml-2 inline-flex items-center gap-1 text-muted-foreground">
                        <input type="checkbox" checked={recount(line)} onChange={(event) => setDrafts((current) => ({ ...current, [line.id]: { ...current[line.id], recount: event.target.checked } }))} />Recount
                      </label>
                    ) : recount(line) ? <span className="ml-2 text-signal-rose-ink">recount</span> : null}
                  </td>
                </tr>
              )
            })}
            {!visible.length ? <tr><td colSpan={7} className="px-4 py-10 text-center text-[12.5px] text-muted-foreground">{lines.length ? "No line matches these filters." : "This sheet has no lines. Refresh to load every active material."}</td></tr> : null}
          </tbody>
        </table>
      </div>
      <p className="border-t border-border px-4 py-2 text-[11.5px] text-muted-foreground">Enter moves to the next line. ✓ means counted and equal to book. Certify needs every line counted; variances then post as one adjustment voucher.</p>
    </section>
  )
}
