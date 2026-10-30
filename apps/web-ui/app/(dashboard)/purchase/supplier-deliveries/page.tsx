"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { AlarmClock, CalendarCheck2, CalendarClock, CalendarRange, CalendarPlus, PackageCheck, Sun, Truck } from "lucide-react"

import { Field, MessageBar, ProcurementShell, SummaryCard, WorkPanel, fieldClass, primaryButton, secondaryButton } from "@/components/procurement/procurement-shell"
import { ArrivalChip } from "@/components/procurement/rm-calendar/atoms"
import { longDate, perUnit, qty, relativeDay, unitWord } from "@/components/procurement/rm-calendar/format"
import { EmptyQueryState, ErrorState, LoadingState } from "@/components/workspace/query-state"
import { RoleGate } from "@/components/workspace/role-gate"
import { useAuth } from "@/context/AuthContext"
import { useExpectedArrivals, useRefreshPurchasing } from "@/hooks/use-rm-calendar"
import { purchaseApi } from "@/lib/api"
import { apiErrorText, type ExpectedArrival } from "@/lib/api-rm-calendar"
import { businessDate } from "@/lib/business-date"
import { cn } from "@/lib/utils"

const BUCKETS: Array<{ id: ExpectedArrival["bucket"]; title: string; detail: string; icon: typeof AlarmClock; tone: "rose" | "amber" | "cyan" | "slate" }> = [
  { id: "OVERDUE", title: "Overdue", detail: "Date passed, not received", icon: AlarmClock, tone: "rose" },
  { id: "TODAY", title: "Today", detail: "Due today", icon: Sun, tone: "amber" },
  { id: "THIS_WEEK", title: "This week", detail: "Until Sunday", icon: CalendarClock, tone: "cyan" },
  { id: "LATER", title: "Later", detail: "Next week onwards", icon: CalendarRange, tone: "slate" },
]
// Spec 2.8: confirming or moving a vendor date is the purchase desk's (and the Owner's), as on the server.
const DESK_ROLES = ["Store", "Planner", "PlantManager", "Owner"]

export default function ExpectedArrivalsPage() {
  const { user, activeRole } = useAuth()
  const roles = new Set([user?.role, activeRole, ...(user?.roles || [])].filter(Boolean) as string[])
  const canEdit = DESK_ROLES.some((role) => roles.has(role))
  const canReceive = canEdit || roles.has("GRN") || roles.has("Admin")
  const arrivals = useExpectedArrivals()
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null)
  const items = useMemo(() => arrivals.data?.items || [], [arrivals.data])
  const grouped = useMemo(() => Object.fromEntries(BUCKETS.map((bucket) => [bucket.id, items.filter((row) => row.bucket === bucket.id)])), [items]) as Record<string, ExpectedArrival[]>

  return (
    <RoleGate allow={["Planner", "Store", "PlantManager", "GRN"]}>
      <ProcurementShell eyebrow="Purchasing" title="Expected arrivals"
        description="What vendors should deliver, from every approved PO: confirm the date the vendor gives, and make the GRN when the truck comes. The goods go to the RM store unless you pick another location."
        actions={<Link className={cn(secondaryButton, "max-sm:h-11")} href="/purchase/scheduler"><CalendarRange className="h-4 w-4" aria-hidden="true" />RM inward calendar</Link>}>
        {notice ? <MessageBar tone={notice.tone}>{notice.text}</MessageBar> : null}
        <section className="grid grid-cols-2 gap-2.5 sm:gap-3 xl:grid-cols-4 [&_article]:h-full" aria-label="Summary">
          {BUCKETS.map((bucket) => {
            const rows = grouped[bucket.id] || []
            const units = rows.reduce((totals, row) => ({ ...totals, [row.uom]: (totals[row.uom] || 0) + row.open_qty }), {} as Record<string, number>)
            return <a key={bucket.id} href={`#${bucket.id.toLowerCase()}`} className="block rounded-xl"><SummaryCard label={bucket.title} value={arrivals.isSuccess ? rows.length : "—"} icon={bucket.icon} tone={rows.length ? bucket.tone : "slate"} detail={rows.length ? perUnit(units) : bucket.detail} /></a>
          })}
        </section>
        {arrivals.isLoading ? <LoadingState label="Loading expected arrivals…" /> : null}
        {arrivals.isError ? <ErrorState title="Expected arrivals could not be loaded" message={apiErrorText(arrivals.error)} onRetry={() => arrivals.refetch()} /> : null}
        {arrivals.isSuccess && !items.length ? <EmptyQueryState title="Nothing is expected" message="No approved PO has an open delivery. Approved arrivals on the RM inward calendar show up here once their PO is approved and sent." /> : null}
        {arrivals.isSuccess ? BUCKETS.map((bucket) => (grouped[bucket.id] || []).length ? (
          <WorkPanel key={bucket.id} title={`${bucket.title} · ${grouped[bucket.id].length}`} description={bucket.id === "OVERDUE" ? "Chase the vendor and record the new date, or make the GRN if the goods came." : undefined}>
            <span id={bucket.id.toLowerCase()} className="sr-only" />
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
              {grouped[bucket.id].map((row) => <ArrivalLine key={row.id} row={row} today={arrivals.data!.today} canEdit={canEdit} canReceive={canReceive} onNotice={setNotice} />)}
            </ul>
          </WorkPanel>
        ) : null) : null}
        {canEdit ? <AddCommitment onNotice={setNotice} /> : null}
      </ProcurementShell>
    </RoleGate>
  )
}

function ArrivalLine({ row, today, canEdit, canReceive, onNotice }: { row: ExpectedArrival; today: string; canEdit: boolean; canReceive: boolean; onNotice: (notice: { tone: "success" | "error"; text: string }) => void }) {
  const refresh = useRefreshPurchasing()
  const [mode, setMode] = useState<null | "confirm" | "date">(null)
  const [day, setDay] = useState(row.date >= today ? row.date : today)
  const [reason, setReason] = useState("")
  const save = useMutation({
    mutationFn: async () => {
      if (row.schedule_id) {
        return purchaseApi.updateSchedule(row.schedule_id, { expected_version: row.schedule_version || 1, current_date: day,
          confirmation_status: mode === "confirm" ? "CONFIRMED" : "TENTATIVE", reason: mode === "confirm" ? (reason.trim() || "Vendor confirmed") : reason.trim() })
      }
      return purchaseApi.commitSchedules(row.po_id!, { rows: [{ purchase_order_line_id: row.po_line_id, scheduled_qty: row.open_qty, promised_date: day, current_date: day, confirmation_status: mode === "confirm" ? "CONFIRMED" : "TENTATIVE", notes: reason.trim() || null }] })
    },
    onSuccess: () => { refresh(); setMode(null); setReason(""); onNotice({ tone: "success", text: `${row.po_no} · ${row.item_name}: ${mode === "confirm" ? "vendor confirmed for" : "date changed to"} ${longDate(day)}.` }) },
    onError: (failure) => onNotice({ tone: "error", text: apiErrorText(failure) }),
  })
  const reasonNeeded = mode === "date" && reason.trim().length < 3
  return (
    <li className="px-3 py-3 sm:px-4">
      <div className="grid gap-2 sm:grid-cols-[124px_minmax(0,1fr)_auto] sm:items-center">
        <div>
          <p className={cn("text-[13.5px] font-semibold", row.bucket === "OVERDUE" ? "text-signal-rose-ink" : "text-foreground")}>{relativeDay(row.date, today)}</p>
          <p className="text-[11.5px] text-muted-foreground">{longDate(row.date)}{row.no_date ? " · no date on PO" : ""}</p>
        </div>
        <div className="min-w-0 space-y-1">
          <p className="text-[13.5px] font-semibold text-foreground">{row.item_name}</p>
          <p className="break-all text-[12px] text-muted-foreground">{row.item_code}</p>
          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12.5px] text-muted-foreground">
            <ArrivalChip arrival={row} uom={row.uom} hideAmount />
            <span><span className="font-semibold tabular-nums text-foreground">{qty(row.open_qty, row.uom)}</span> still to come{row.received_qty > 0 ? ` of ${qty(row.qty, row.uom)} · ${qty(row.received_qty, row.uom)} already received` : ""}</span>
          </p>
          {/* Vendor and PO on their own line: a separator never starts a wrapped line. */}
          <p className="flex flex-wrap items-center gap-x-1.5 text-[12.5px] text-muted-foreground">
            <span className="min-w-0 truncate">{row.supplier_name || "Vendor not named"}</span>
            <span aria-hidden="true">·</span>
            {canEdit ? <Link href={`/purchase/${row.po_id}`} className="inline-flex min-h-6 items-center rounded px-1 font-semibold text-signal-cyan-ink hover:underline max-sm:min-h-11">{row.po_no}</Link> : <span className="font-semibold text-foreground">{row.po_no}</span>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 sm:justify-end">
          {canEdit && row.confirmation !== "CONFIRMED" ? <button type="button" className={cn(secondaryButton, "max-sm:h-11")} onClick={() => setMode(mode === "confirm" ? null : "confirm")}><CalendarCheck2 className="h-4 w-4" aria-hidden="true" />{row.schedule_id ? "Confirm" : "Add date"}</button> : null}
          {canEdit && row.schedule_id ? <button type="button" className={cn(secondaryButton, "max-sm:h-11")} onClick={() => setMode(mode === "date" ? null : "date")}><CalendarPlus className="h-4 w-4" aria-hidden="true" />Change date</button> : null}
          {canReceive && row.po_line_id ? <Link className={cn(primaryButton, "max-sm:h-11")} href={`/purchase/inward?po=${row.po_id}&line=${row.po_line_id}`}><Truck className="h-4 w-4" aria-hidden="true" />Make GRN</Link> : null}
        </div>
      </div>
      {mode ? (
        <form className="mt-3 grid gap-3 rounded-lg border border-border bg-[hsl(var(--surface-2))] p-3 sm:grid-cols-[180px_minmax(0,1fr)_auto] sm:items-end" onSubmit={(event) => { event.preventDefault(); if (!reasonNeeded) save.mutate() }}>
          <Field label={mode === "confirm" ? "Date the vendor gives" : "New date"}><input className={cn(fieldClass, "max-sm:h-11")} type="date" required min={today} value={day} onChange={(event) => setDay(event.target.value)} /></Field>
          <Field label={mode === "confirm" ? "Note" : "Why it moved"} hint={mode === "confirm" ? "optional" : "required"}><input className={cn(fieldClass, "max-sm:h-11")} value={reason} minLength={mode === "date" ? 3 : undefined} required={mode === "date"} onChange={(event) => setReason(event.target.value)} placeholder={mode === "confirm" ? "Confirmed on call" : "Mill shut, truck late…"} /></Field>
          <div className="flex gap-2"><button className={cn(primaryButton, "max-sm:h-11")} disabled={save.isPending || reasonNeeded}>{save.isPending ? "Saving…" : "Save"}</button><button type="button" className={cn(secondaryButton, "max-sm:h-11")} onClick={() => setMode(null)}>Close</button></div>
        </form>
      ) : null}
    </li>
  )
}

/** Hand-made POs: add a dated delivery for a line (kept from the old supplier-deliveries desk). */
function AddCommitment({ onNotice }: { onNotice: (notice: { tone: "success" | "error"; text: string }) => void }) {
  const { activePlant } = useAuth()
  const refresh = useRefreshPurchasing()
  const orders = useQuery({ queryKey: ["purchase-v2", "orders", "open-for-dates", activePlant], enabled: Boolean(activePlant && activePlant !== "ALL"),
    queryFn: async () => {
      const pages = await Promise.all(["APPROVED", "PARTIALLY_RECEIVED"].map((status) => purchaseApi.getOrders({ status, limit: 200 })))
      return pages.flatMap((page) => page.data?.items || [])
    } })
  const [form, setForm] = useState({ order: "", line: "", quantity: "", date: businessDate(), status: "TENTATIVE" })
  useEffect(() => setForm({ order: "", line: "", quantity: "", date: businessDate(), status: "TENTATIVE" }), [activePlant])
  const selected = (orders.data || []).find((row: any) => row.id === form.order)
  const line = selected?.lines?.find((row: any) => row.id === form.line)
  const add = useMutation({
    mutationFn: () => purchaseApi.commitSchedules(form.order, { rows: [{ purchase_order_line_id: form.line, scheduled_qty: Number(form.quantity), promised_date: form.date, current_date: form.date, confirmation_status: form.status }] }),
    onSuccess: () => { refresh(); onNotice({ tone: "success", text: "Delivery date saved." }); setForm({ ...form, quantity: "" }) },
    onError: (failure) => onNotice({ tone: "error", text: apiErrorText(failure) }),
  })
  return (
    <details className="erp-panel rounded-xl p-4 sm:p-5">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-[15px] font-semibold text-foreground"><PackageCheck className="h-4 w-4 text-signal-cyan-ink" aria-hidden="true" />Add a delivery date to a PO<span className="ml-auto text-[12px] font-normal text-muted-foreground">for hand-made POs and split deliveries</span></summary>
      <form className="mt-4 grid gap-3 md:grid-cols-3" onSubmit={(event) => { event.preventDefault(); add.mutate() }}>
        <Field label="Purchase order"><select className={cn(fieldClass, "max-sm:h-11")} required value={form.order} onChange={(event) => setForm({ ...form, order: event.target.value, line: "" })}><option value="">Pick a PO</option>{(orders.data || []).map((row: any) => <option key={row.id} value={row.id}>{row.po_no} · {row.supplier_name}</option>)}</select></Field>
        <Field label="Material"><select className={cn(fieldClass, "max-sm:h-11")} required value={form.line} onChange={(event) => setForm({ ...form, line: event.target.value })}><option value="">Pick a material</option>{(selected?.lines || []).map((row: any) => <option key={row.id} value={row.id}>{row.item_name || row.item_code} · {qty(row.qty_ordered - row.qty_received - (row.qty_short_closed || 0), row.uom)} open</option>)}</select></Field>
        <Field label={`Quantity${line ? ` (${unitWord(line.uom)})` : ""}`}><input className={cn(fieldClass, "max-sm:h-11")} type="number" inputMode="decimal" min="0.001" step="0.001" required value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} /></Field>
        <Field label="Arrives on"><input className={cn(fieldClass, "max-sm:h-11")} type="date" required min={businessDate()} value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} /></Field>
        <Field label="Vendor confirmation"><select className={cn(fieldClass, "max-sm:h-11")} value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}><option value="TENTATIVE">Not confirmed yet</option><option value="CONFIRMED">Vendor confirmed</option></select></Field>
        <button className={cn(primaryButton, "self-end max-sm:h-11")} disabled={add.isPending}>{add.isPending ? "Saving…" : "Save delivery date"}</button>
      </form>
    </details>
  )
}
