"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"

import { NoteCallout, Panel } from "@/components/reports/primitives"
import { useReasonList } from "@/components/reasons"
import { useCustomers } from "@/hooks/use-master-data"
import { api } from "@/lib/api"

/**
 * Cancelled / short-closed by reason (owner decision 4, 1 Nov 2026): orders closed early, grouped by their
 * "Order cancel / short close" reason, customer and month — order count and pieces lost. A cancelled order
 * loses its whole qty; a short-closed one the balance that was dropped.
 */
type Group = { reason_code?: string; reason_label?: string; customer_id?: string; month?: string; orders: number; cancelled: number; short_closed: number; qty: number; value: number }
type Report = { totals: { orders: number; cancelled: number; short_closed: number; qty: number; value: number }; by_reason: Group[]; by_customer: Group[]; by_month: Group[]; by_reason_customer_month: Group[] }

const fmt = (value: unknown) => Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })
const monthText = (value?: string) => {
  if (!value) return "—"
  const [y, m] = value.split("-").map(Number)
  return new Date(y, (m || 1) - 1, 1).toLocaleDateString("en-IN", { month: "short", year: "numeric" })
}
const isoDaysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)

export function useClosuresByReason(params: Record<string, string | undefined>) {
  return useQuery({
    queryKey: ["sales-orders", "closures-by-reason", params],
    queryFn: async () => {
      const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v))
      const { data } = await api.get("/api/sales/orders/reports/closures-by-reason", { params: clean })
      return data as Report
    },
  })
}

export function ClosuresByReason() {
  const [from, setFrom] = useState(isoDaysAgo(180))
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10))
  const [kind, setKind] = useState("")
  const [customerId, setCustomerId] = useState("")
  const [view, setView] = useState<"reason" | "customer" | "month" | "detail">("reason")
  const report = useClosuresByReason({ date_from: from, date_to: to, kind, customer_id: customerId })
  const customersQuery = useCustomers()
  const customers: any[] = useMemo(() => (Array.isArray(customersQuery.data) ? customersQuery.data : []), [customersQuery.data])
  const customerName = (id?: string) => {
    const row = customers.find((c) => String(c.id) === String(id || ""))
    return row ? row.name || row.customer_name || row.customer_code : id ? "Customer not in masters" : "—"
  }
  const reasons = useReasonList("SO_CLOSE")
  const data = report.data
  const rows: Group[] = (view === "reason" ? data?.by_reason : view === "customer" ? data?.by_customer : view === "month" ? data?.by_month : data?.by_reason_customer_month) || []
  const maxQty = Math.max(1, ...rows.map((row) => Number(row.qty || 0)))
  const registerHref = (code?: string) => `/sales-orders?reason_code=${encodeURIComponent(code || "")}`
  const input = "h-9 rounded-md border border-border bg-card px-2 text-[13px]"

  return (
    <Panel
      eyebrow="Lost quantity"
      title="Cancelled / short-closed by reason"
      description="Orders cancelled or short-closed in the period, by reason, customer and month. Pieces lost: the whole order for a cancel, the dropped balance for a short close."
    >
      <div className="mb-3 flex flex-wrap items-end gap-2" data-testid="closures-by-reason:filters">
        <label className="grid gap-1 text-[12px] font-medium text-muted-foreground">From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={input} /></label>
        <label className="grid gap-1 text-[12px] font-medium text-muted-foreground">To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={input} /></label>
        <label className="grid gap-1 text-[12px] font-medium text-muted-foreground">Kind
          <select value={kind} onChange={(e) => setKind(e.target.value)} className={input}>
            <option value="">Cancelled and short-closed</option><option value="CANCELLED">Cancelled</option><option value="SHORT_CLOSED">Short-closed</option>
          </select>
        </label>
        <label className="grid min-w-0 gap-1 text-[12px] font-medium text-muted-foreground">Customer
          <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className={`${input} max-w-[16rem]`}>
            <option value="">All customers</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name || c.customer_name || c.customer_code}</option>)}
          </select>
        </label>
        <div className="ml-auto flex flex-wrap gap-1" role="tablist" aria-label="Group by">
          {(["reason", "customer", "month", "detail"] as const).map((key) => (
            <button key={key} type="button" role="tab" aria-selected={view === key} onClick={() => setView(key)} data-testid={`closures-by-reason:view-${key}`}
              className={`min-h-9 rounded-full border px-3 text-[12.5px] font-semibold ${view === key ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground"}`}>
              {key === "reason" ? "By reason" : key === "customer" ? "By customer" : key === "month" ? "By month" : "Reason × customer × month"}
            </button>
          ))}
        </div>
      </div>
      {report.isLoading ? <p role="status" className="text-[13px] text-muted-foreground">Loading…</p> : report.isError ? (
        <NoteCallout tone="critical">The report could not be loaded. <button type="button" className="font-semibold underline" onClick={() => void report.refetch()}>Try again</button></NoteCallout>
      ) : !data?.totals.orders ? <NoteCallout tone="neutral">No order was cancelled or short-closed in this period.</NoteCallout> : (
        <>
          <p className="mb-2 text-[13px] text-muted-foreground" data-testid="closures-by-reason:totals">
            <strong className="text-foreground">{fmt(data.totals.orders)}</strong> orders ({fmt(data.totals.cancelled)} cancelled, {fmt(data.totals.short_closed)} short-closed) ·{" "}
            <strong className="text-foreground">{fmt(data.totals.qty)} pcs</strong> lost{data.totals.value ? <> · ₹{fmt(data.totals.value)}</> : null}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="closures-by-reason:table">
              <thead>
                <tr className="border-b border-border text-left text-[12px] font-semibold text-muted-foreground">
                  {view !== "customer" && view !== "month" ? <th className="py-2 pr-3">Reason</th> : null}
                  {view === "customer" || view === "detail" ? <th className="py-2 pr-3">Customer</th> : null}
                  {view === "month" || view === "detail" ? <th className="py-2 pr-3">Month</th> : null}
                  <th className="py-2 pr-3 text-right">Orders</th>
                  <th className="py-2 pr-3 text-right">Cancelled</th>
                  <th className="py-2 pr-3 text-right">Short-closed</th>
                  <th className="py-2 pr-3 text-right">Pcs lost</th>
                  <th className="hidden py-2 pr-3 sm:table-cell" aria-hidden />
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={`${row.reason_code}-${row.customer_id}-${row.month}-${index}`} className="border-b border-border">
                    {view !== "customer" && view !== "month" ? (
                      <td className="py-2 pr-3">
                        <Link href={registerHref(row.reason_code)} className="font-medium text-foreground hover:underline">{row.reason_label || reasons.data?.find((r) => r.code === row.reason_code)?.label || row.reason_code}</Link>
                        <span className="ml-1 font-mono text-[11px] text-muted-foreground">{row.reason_code}</span>
                      </td>
                    ) : null}
                    {view === "customer" || view === "detail" ? <td className="py-2 pr-3">{customerName(row.customer_id)}</td> : null}
                    {view === "month" || view === "detail" ? <td className="py-2 pr-3">{monthText(row.month)}</td> : null}
                    <td className="py-2 pr-3 text-right">{fmt(row.orders)}</td>
                    <td className="py-2 pr-3 text-right">{fmt(row.cancelled)}</td>
                    <td className="py-2 pr-3 text-right">{fmt(row.short_closed)}</td>
                    <td className="py-2 pr-3 text-right font-semibold">{fmt(row.qty)}</td>
                    <td className="hidden w-32 py-2 pr-3 sm:table-cell"><div className="h-2 rounded-full bg-muted"><div className="h-2 rounded-full bg-signal-amber-ink" style={{ width: `${(Number(row.qty || 0) / maxQty) * 100}%` }} /></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[12px] text-muted-foreground">Click a reason to open those orders in the sales order register.</p>
        </>
      )}
    </Panel>
  )
}
