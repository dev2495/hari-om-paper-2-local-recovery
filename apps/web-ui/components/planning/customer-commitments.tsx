"use client"

import Link from "next/link"
import dayjs from "dayjs"
import { useEffect, useMemo, useState } from "react"
import { ChevronDown, Truck } from "lucide-react"
import { useDeliveryCalendar, type DeliveryCalendarRow } from "@/hooks/use-sales"
import { useCustomers } from "@/hooks/use-master-data"
import { cn } from "@/lib/utils"

const fmt = (n: number) => Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })

export function DeliveryDayBadge({ rows }: { rows: DeliveryCalendarRow[] }) {
  if (!rows.length) return null
  return <span className="flex items-center gap-1 rounded-md bg-signal-blue-soft px-1.5 py-1 text-[11px] font-medium text-signal-blue-ink" title={rows.map(row => `${row.order_no} · ${fmt(row.qty)} pcs · ${row.source === "CALL_OFF" ? "confirmed call-off" : "order due"}`).join("\n")}><Truck className="h-3 w-3 shrink-0" />Customer due · {fmt(rows.reduce((sum, row) => sum + Number(row.qty || 0), 0))} pcs</span>
}

/** One shared, plant-scoped delivery source for purchasing and machine planning. */
export function CustomerCommitments({ dateFrom, dateTo, selectedDate, onDate }: { dateFrom: string; dateTo: string; selectedDate?: string; onDate?: (date: string) => void }) {
  const query = useDeliveryCalendar(dateFrom, dateTo)
  const customers = useCustomers()
  const [expanded, setExpanded] = useState(false)
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(0)
  useEffect(() => { setPage(0) }, [dateFrom, dateTo, query.data])
  const names = useMemo(() => new Map((Array.isArray(customers.data) ? customers.data : []).map((row: any) => [String(row.id), row.name || row.code])), [customers.data])
  const rows = useMemo(() => [...(query.data || [])].sort((a, b) => a.date.localeCompare(b.date) || a.order_no.localeCompare(b.order_no)), [query.data])
  const days = useMemo(() => {
    const grouped = new Map<string, DeliveryCalendarRow[]>()
    for (const row of rows) { if (!grouped.has(row.date)) grouped.set(row.date, []); grouped.get(row.date)!.push(row) }
    return [...grouped.entries()]
  }, [rows])
  const filtered = rows.filter(row => `${names.get(String(row.customer_id)) || ""} ${row.order_no} ${row.po_number || ""} ${row.product_code || ""}`.toLowerCase().includes(search.toLowerCase()))
  return <section className="overflow-hidden rounded-xl border border-border bg-card" data-testid="customer-commitments">
    <div className="flex flex-wrap items-center gap-3 px-3 py-2">
      <Truck className="h-4 w-4 text-signal-blue-ink" />
      <div className="mr-auto"><h2 className="text-[13px] font-semibold">Customer commitments</h2><p className="text-[11px] text-muted-foreground">{dayjs(dateFrom).format("D MMM")} – {dayjs(dateTo).format("D MMM")} · call-offs and unscheduled order balances</p></div>
      <button type="button" className="erp-btn-secondary !h-9" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{query.isLoading ? "Loading…" : query.isError ? "Unavailable" : `${rows.length} deliveries · ${fmt(rows.reduce((sum, row) => sum + Number(row.qty || 0), 0))} pcs`}<ChevronDown className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")} /></button>
    </div>
    {query.isError ? <div role="alert" className="px-3 pb-3 text-sm text-signal-rose-ink">Customer dates could not load. <button className="underline" onClick={() => query.refetch()}>Retry</button></div> : null}
    {!query.isError && !query.isLoading && !rows.length ? <p className="px-3 pb-3 text-xs text-muted-foreground">No customer commitments in this date window. Existing work can still be planned.</p> : null}
    {days.length ? <div className="flex gap-2 overflow-x-auto border-t border-border px-3 py-2">{days.map(([date, entries]) => <button key={date} type="button" onClick={() => { onDate?.(date); setExpanded(true) }} className={cn("min-w-[148px] rounded-lg border px-3 py-2 text-left", selectedDate === date ? "border-primary bg-primary/5" : "border-signal-blue-line bg-signal-blue-soft/50")}><span className="flex justify-between gap-3 text-xs font-semibold"><span>{dayjs(date).format("ddd D MMM")}</span><span className="text-signal-blue-ink">{fmt(entries.reduce((sum, row) => sum + Number(row.qty || 0), 0))} pcs</span></span><span className="mt-1 block max-w-[220px] truncate text-[11px] text-muted-foreground">{[...new Set(entries.map(row => names.get(String(row.customer_id)) || row.order_no))].join(", ")}</span></button>)}</div> : null}
    {expanded && !query.isError ? <div className="border-t border-border p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2"><input aria-label="Find customer commitment" placeholder="Find customer, PO or item…" value={search} onChange={event => {setSearch(event.target.value); setPage(0)}} className="h-9 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-sm" /><span className="text-xs text-muted-foreground">Customer quantities are pcs; material demand is shown separately.</span></div>
      <div className="max-h-64 overflow-auto"><table className="tube-grid w-full"><thead><tr><th>Delivery date</th><th>Customer / PO</th><th>Item</th><th>Commitment</th><th className="num">Pieces</th><th /></tr></thead><tbody>{filtered.slice(page*25, page*25+25).map((row, index) => <tr key={`${row.schedule_id || row.line_id}:${row.date}:${index}`}><td><button className="font-medium text-primary" onClick={() => onDate?.(row.date)}>{dayjs(row.date).format("D MMM YYYY")}</button></td><td><p className="font-medium">{names.get(String(row.customer_id)) || row.order_no}</p><p className="text-xs text-muted-foreground">{row.po_number || row.order_no}</p></td><td>{row.size_label || row.product_code || "—"}</td><td>{row.source === "CALL_OFF" ? "Customer call-off" : "Order due date"}{row.is_held ? " · on hold" : ""}</td><td className="num">{fmt(row.qty)}</td><td><Link className="font-medium text-primary" href={`/sales-orders/${row.order_id}`}>Open order ↗</Link></td></tr>)}</tbody></table></div>
      {filtered.length > 25 ? <div className="mt-2 flex items-center justify-end gap-3 text-xs"><button disabled={page === 0} onClick={() => setPage(page-1)}>Previous</button><span>{page*25+1}–{Math.min((page+1)*25, filtered.length)} of {filtered.length}</span><button disabled={(page+1)*25 >= filtered.length} onClick={() => setPage(page+1)}>Next</button></div> : null}
    </div> : null}
  </section>
}
