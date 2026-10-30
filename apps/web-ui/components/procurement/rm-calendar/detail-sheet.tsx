"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { ArrowRight, CalendarClock, CheckCircle2, ClipboardList, ExternalLink, Factory, PackagePlus, PencilLine, Plus, Trash2, Truck } from "lucide-react"

import { Field, MessageBar, fieldClass, primaryButton, secondaryButton } from "@/components/procurement/procurement-shell"
import { useApproveArrivals, useCancelArrival, useProposeArrivals, useUpdateArrival } from "@/hooks/use-rm-calendar"
import { apiErrorText, type Arrival, type CalendarData, type CalendarMaterial } from "@/lib/api-rm-calendar"
import { cn } from "@/lib/utils"

import { ArrivalChip, BalanceBar, CoverBadge, StatPair } from "./atoms"
import { CLASS_LABEL, dayCoverWord, dayLabel, longDate, personName, qty, rateText, relativeDay, rupees, shortDate, unitWord } from "./format"
import { Sheet } from "./sheet"

export type Vendor = { id: string; name: string; supplier_code?: string; contact_phone?: string | null; contact_email?: string | null; is_active?: boolean }
export type Permissions = { canPropose: boolean; isOwner: boolean; canReceive: boolean }
export type Notice = { tone: "success" | "error" | "info"; text: string; href?: string; linkText?: string }

const tap = "max-sm:h-11"

/** Scale for balance bars: the larger of stock, the biggest balance and the biggest day's need. */
export function balanceScale(material: CalendarMaterial): number {
  return Math.max(1, material.stock_now, material.min_stock || 0, ...material.balance.map(Math.abs), ...material.need)
}

export function ArrivalForm({ data, material, materials, defaultDate, vendors, permissions, onDone, compact = false }: {
  data: CalendarData
  material?: CalendarMaterial | null
  materials?: CalendarMaterial[]
  defaultDate?: string
  vendors: Vendor[]
  permissions: Permissions
  onDone: (notice: Notice) => void
  compact?: boolean
}) {
  const [itemId, setItemId] = useState(material?.item_id || "")
  const picked = material || materials?.find((row) => row.item_id === itemId) || null
  const index = defaultDate ? data.days.indexOf(defaultDate) : -1
  const shortQty = picked && index >= 0 && picked.balance[index] < 0 ? Math.ceil(-picked.balance[index]) : picked?.first_short ? Math.ceil(picked.first_short.qty) : 0
  const [day, setDay] = useState(defaultDate && defaultDate >= data.today ? defaultDate : picked?.first_short ? (picked.first_short.date > data.today ? addDay(picked.first_short.date, -1) : data.today) : data.today)
  const [amount, setAmount] = useState(shortQty ? String(shortQty) : "")
  const [vendorId, setVendorId] = useState(picked?.last_vendor?.supplier_id || "")
  const [note, setNote] = useState("")
  const [error, setError] = useState("")
  const propose = useProposeArrivals()
  const approve = useApproveArrivals()
  useEffect(() => {
    if (!picked) return
    setVendorId(picked.last_vendor?.supplier_id || "")
    if (!material) setAmount(picked.first_short ? String(Math.ceil(picked.first_short.qty)) : "")
  }, [picked?.item_id]) // eslint-disable-line react-hooks/exhaustive-deps
  const vendor = vendors.find((row) => String(row.id) === vendorId)
  const busy = propose.isPending || approve.isPending
  const valid = Boolean(picked && day && Number(amount) > 0)

  async function submit(andApprove: boolean) {
    if (!picked) return
    setError("")
    try {
      const response = await propose.mutateAsync([{ item_id: picked.item_id, entry_date: day, qty: Number(amount), supplier_id: vendor?.id || null, supplier_name: vendor?.name || null, note: note.trim() || null }])
      const created = (response.data as any)?.items?.[0]
      if (andApprove && created?.id) {
        const result = await approve.mutateAsync({ entryIds: [created.id], supplierIds: vendor ? [vendor.id] : [] })
        const order = result.purchase_orders[0]
        onDone({ tone: "success", text: order ? `Approved. ${picked.item_name} is on draft ${order.po_no} for ${order.supplier_name}, ready to send.` : result.skipped[0]?.reason || "Approved.",
          href: order ? `/purchase/${order.id}` : undefined, linkText: order ? `Open ${order.po_no}` : undefined })
      } else {
        onDone({ tone: "success", text: `${qty(Number(amount), picked.uom)} of ${picked.item_name} proposed for ${longDate(day)}. ${permissions.isOwner ? "Approve it when ready." : "The Owner gets it for approval."}` })
      }
      setAmount(""); setNote("")
    } catch (failure) {
      setError(apiErrorText(failure))
    }
  }

  return (
    <form className={cn("space-y-3", compact ? "" : "rounded-xl border border-border bg-[hsl(var(--surface-2))] p-3.5")} onSubmit={(event) => { event.preventDefault(); if (valid) submit(false) }}>
      {!compact ? <p className="flex items-center gap-2 text-[13px] font-semibold text-foreground"><PackagePlus className="h-4 w-4 text-signal-teal-ink" aria-hidden="true" />Add an arrival</p> : null}
      {!material && materials ? (
        <Field label="Material">
          <select className={cn(fieldClass, tap)} value={itemId} onChange={(event) => setItemId(event.target.value)} required>
            <option value="">Pick a material</option>
            {materials.map((row) => <option key={row.item_id} value={row.item_id}>{row.item_name} · {row.item_code}</option>)}
          </select>
        </Field>
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Arrives on">
          <input className={cn(fieldClass, tap)} type="date" required min={data.today} value={day} onChange={(event) => setDay(event.target.value)} />
        </Field>
        <Field label={`Quantity${picked ? ` (${unitWord(picked.uom)})` : ""}`} hint={shortQty && picked ? `short ${qty(shortQty, picked.uom)}` : undefined}>
          <input className={cn(fieldClass, tap, "tabular-nums")} type="number" inputMode="decimal" min="0.001" step={picked?.uom === "PCS" ? "1" : "0.001"} required value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0" />
        </Field>
      </div>
      <Field label="Vendor" hint={picked?.last_vendor ? `last: ${picked.last_vendor.supplier_name}` : "needed before approval"}>
        <select className={cn(fieldClass, tap)} value={vendorId} onChange={(event) => setVendorId(event.target.value)}>
          <option value="">Not decided yet</option>
          {vendors.filter((row) => row.is_active !== false).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
        </select>
      </Field>
      <Field label="Note" hint="optional">
        <input className={cn(fieldClass, tap)} value={note} maxLength={300} onChange={(event) => setNote(event.target.value)} placeholder="Truck, grade, reason…" />
      </Field>
      {error ? <MessageBar tone="error">{error}</MessageBar> : null}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={cn(permissions.isOwner ? secondaryButton : primaryButton, tap, "flex-1 sm:flex-none")} disabled={!valid || busy}>
          <Plus className="h-4 w-4" aria-hidden="true" />{propose.isPending && !approve.isPending ? "Saving…" : "Propose arrival"}
        </button>
        {permissions.isOwner ? (
          <button type="button" className={cn(primaryButton, tap, "flex-1 sm:flex-none")} disabled={!valid || busy || !vendor} title={vendor ? undefined : "Pick a vendor to approve"} onClick={() => submit(true)}>
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />{approve.isPending ? "Approving…" : "Add and approve"}
          </button>
        ) : null}
      </div>
    </form>
  )
}

function addDay(day: string, count: number) {
  const [y, m, d] = day.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d + count)).toISOString().slice(0, 10)
}

export function ArrivalRow({ arrival, material, data, vendors, permissions, onNotice, onMoveConfirm }: {
  arrival: Arrival
  material: CalendarMaterial
  data: CalendarData
  vendors: Vendor[]
  permissions: Permissions
  onNotice: (notice: Notice) => void
  onMoveConfirm: (arrival: Arrival, day: string, qtyValue?: number) => void
}) {
  const [editing, setEditing] = useState(false)
  const [day, setDay] = useState(arrival.date >= data.today ? arrival.date : data.today)
  const [amount, setAmount] = useState(String(arrival.qty))
  const [vendorId, setVendorId] = useState(arrival.supplier_id || "")
  const update = useUpdateArrival()
  const cancel = useCancelArrival()
  const approve = useApproveArrivals()
  const proposal = arrival.state === "PROPOSED"
  const owned = Boolean(arrival.entry_id)
  const draftPo = arrival.po_status === "DRAFT" || !arrival.po_id
  const canEdit = owned && arrival.state !== "RECEIVED" && (proposal ? permissions.canPropose : permissions.isOwner && arrival.movable)
  const canCancel = owned && (proposal ? permissions.canPropose : permissions.isOwner && draftPo && arrival.state !== "RECEIVED")
  const busy = update.isPending || cancel.isPending || approve.isPending
  const vendor = vendors.find((row) => String(row.id) === vendorId)

  async function save() {
    if (!arrival.entry_id) return
    const body: any = { id: arrival.entry_id }
    if (day !== arrival.date) body.entry_date = day
    if (Number(amount) !== arrival.qty) body.qty = Number(amount)
    if (proposal && vendorId !== (arrival.supplier_id || "")) { body.supplier_id = vendor?.id || null; body.supplier_name = vendor?.name || null }
    if (Object.keys(body).length === 1) { setEditing(false); return }
    if (body.entry_date && arrival.sent_at && ["APPROVED", "PARTIALLY_RECEIVED"].includes(String(arrival.po_status))) { onMoveConfirm(arrival, day, body.qty); return }
    try {
      const result = await update.mutateAsync(body)
      if (result.needs_po_change) { onMoveConfirm(arrival, day, body.qty); return }
      setEditing(false)
      onNotice({ tone: "success", text: `${material.item_name} arrival saved for ${longDate(day)}.` })
    } catch (failure) {
      onNotice({ tone: "error", text: apiErrorText(failure) })
    }
  }

  return (
    <li className="rounded-xl border border-border bg-card p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1.5">
          <ArrivalChip arrival={arrival} uom={material.uom} size="md" />
          <p className="text-[13px] font-semibold text-foreground">
            {qty(arrival.state === "RECEIVED" ? arrival.received_qty : arrival.qty, material.uom)}
            <span className="font-normal text-muted-foreground"> · {arrival.supplier_name || "No vendor yet"} · {relativeDay(arrival.date, data.today)}</span>
          </p>
          <p className="text-[12px] leading-5 text-muted-foreground">
            {arrival.po_no ? <>On <Link className="font-semibold text-signal-cyan-ink hover:underline" href={`/purchase/${arrival.po_id}`}>{arrival.po_no}</Link>{arrival.po_status === "DRAFT" ? " (draft, not sent)" : ""}. </> : null}
            {arrival.received_qty > 0 && arrival.state !== "RECEIVED" ? `${qty(arrival.received_qty, material.uom)} received, ${qty(arrival.open_qty, material.uom)} still to come. ` : null}
            {arrival.late_proposal ? `Proposed for ${longDate(arrival.date)} and not approved yet; if approved it comes on today. ` : arrival.overdue && arrival.state !== "RECEIVED" ? `Was due ${longDate(arrival.date)}; counted on today. ` : null}
            {proposal && arrival.supplier_id ? `${rateText(arrival.rate, material.uom)}${arrival.rate ? ` (${arrival.rate_source === "RM_COSTING" ? "RM costing" : "last approved PO"}) · about ${rupees(arrival.rate * arrival.qty)}` : " on the draft PO"}. ` : null}
            {arrival.state === "REJECTED" ? "The Owner rejected this PO: it is not counted as arriving until the desk revises it and the Owner approves it. " : null}
            {arrival.state === "RECEIVED" && arrival.planned_date && arrival.planned_date !== arrival.date ? `Received on ${longDate(arrival.date)}; it was planned for ${longDate(arrival.planned_date)}. ` : null}
            {arrival.no_date ? "The PO has no delivery date; shown on today. " : null}
            {arrival.rate_needed && arrival.po_no ? "Rate needed on the PO. " : null}
            {proposal && arrival.proposed_by ? `Proposed by ${personName(arrival.proposed_by)}${arrival.source === "SUGGESTED" ? " from a suggestion" : ""}. ` : null}
            {!proposal && arrival.approved_by && arrival.entry_id ? `Approved by ${personName(arrival.approved_by)}. ` : null}
            {arrival.note ? `“${arrival.note}”` : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {proposal && permissions.isOwner && arrival.entry_id ? (
            <button type="button" className={cn(primaryButton, tap)} disabled={busy || !arrival.supplier_id} title={arrival.supplier_id ? undefined : "Pick a vendor first"}
              onClick={async () => {
                try {
                  const result = await approve.mutateAsync({ entryIds: [arrival.entry_id!], supplierIds: arrival.supplier_id ? [arrival.supplier_id] : [] })
                  const order = result.purchase_orders[0]
                  onNotice(order ? { tone: "success", text: `Approved. On draft ${order.po_no} for ${order.supplier_name}.`, href: `/purchase/${order.id}`, linkText: `Open ${order.po_no}` } : { tone: "info", text: result.skipped[0]?.reason || "Already approved." })
                } catch (failure) { onNotice({ tone: "error", text: apiErrorText(failure) }) }
              }}>
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />Approve
            </button>
          ) : null}
          {canEdit && !editing ? <button type="button" className={cn(secondaryButton, tap)} onClick={() => setEditing(true)}><PencilLine className="h-4 w-4" aria-hidden="true" />{proposal ? "Change" : "Move"}</button> : null}
          {permissions.canReceive && arrival.po_id && arrival.po_line_id && ["APPROVED", "PARTIALLY_RECEIVED"].includes(String(arrival.po_status)) && arrival.open_qty > 0 ? (
            <Link className={cn(secondaryButton, tap)} href={`/purchase/inward?po=${arrival.po_id}&line=${arrival.po_line_id}`}><Truck className="h-4 w-4" aria-hidden="true" />Make GRN</Link>
          ) : null}
        </div>
      </div>
      {editing ? (
        <div className="mt-3 space-y-3 border-t border-border pt-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Arrives on"><input className={cn(fieldClass, tap)} type="date" min={data.today} value={day} onChange={(event) => setDay(event.target.value)} /></Field>
            <Field label={`Quantity (${unitWord(material.uom)})`} hint={!proposal && !draftPo ? "fixed after the PO is approved" : undefined}>
              <input className={cn(fieldClass, tap, "tabular-nums")} type="number" inputMode="decimal" min="0.001" value={amount} disabled={!proposal && !draftPo} onChange={(event) => setAmount(event.target.value)} />
            </Field>
          </div>
          {proposal ? (
            <Field label="Vendor">
              <select className={cn(fieldClass, tap)} value={vendorId} onChange={(event) => setVendorId(event.target.value)}>
                <option value="">Not decided yet</option>
                {vendors.filter((row) => row.is_active !== false).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
              </select>
            </Field>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={cn(primaryButton, tap)} disabled={busy || !(Number(amount) > 0)} onClick={save}>{update.isPending ? "Saving…" : "Save"}</button>
            <button type="button" className={cn(secondaryButton, tap)} onClick={() => setEditing(false)}>Keep as is</button>
            {canCancel ? (
              <button type="button" className={cn(secondaryButton, tap, "text-signal-rose-ink")} disabled={busy}
                onClick={async () => {
                  try { await cancel.mutateAsync({ id: arrival.entry_id!, reason: "Cancelled on the calendar" }); onNotice({ tone: "success", text: `${material.item_name} arrival of ${shortDate(arrival.date)} cancelled.` }) }
                  catch (failure) { onNotice({ tone: "error", text: apiErrorText(failure) }) }
                }}>
                <Trash2 className="h-4 w-4" aria-hidden="true" />Cancel arrival
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </li>
  )
}

function NeedList({ material, rows, today }: { material: CalendarMaterial; rows: CalendarMaterial["needs"]; today: string }) {
  if (!rows.length) return <p className="rounded-lg border border-dashed border-border px-3 py-3 text-[12.5px] text-muted-foreground">No job card or order needs {material.item_name} here.</p>
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
      {rows.map((row, index) => (
        <li key={`${row.job_id || row.order_no}-${row.date}-${index}`} className="flex items-start justify-between gap-3 px-3 py-2.5">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] font-semibold text-foreground">
              {row.job_card_no ? <span className="inline-flex items-center gap-1"><Factory className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />Card {row.job_card_no}</span> : null}
              {row.order_no ? <span className="inline-flex items-center gap-1"><ClipboardList className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />{row.order_no}</span> : null}
              {row.late ? <span className="rounded bg-signal-rose-soft px-1.5 py-0.5 text-[12px] font-semibold text-signal-rose-ink">{lateWords(row)}</span> : null}
            </p>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              {sourceWords(row)}{row.no_date ? ` · counted on ${row.date === today ? "today" : relativeDay(row.date, today)}` : row.date !== today || !row.late ? ` · ${relativeDay(row.date, today)}` : ""}
              {orderDueWords(row)}
              {row.made_pcs ? ` · ${Number(row.made_pcs).toLocaleString("en-IN")} of ${Number(row.planned_pcs || 0).toLocaleString("en-IN")} pcs made` : ""}
            </p>
          </div>
          <span className="shrink-0 text-[13px] font-semibold tabular-nums text-signal-amber-ink">{qty(row.qty, material.uom)}</span>
        </li>
      ))}
    </ul>
  )
}

/** A planner slot is "planned", never "due": only the order's own date is due (checker r4). */
function lateWords(row: CalendarMaterial["needs"][number]) {
  const planned = row.production_plan_date && row.production_plan_date === row.due_date
  return planned ? `Late · planned ${shortDate(row.production_plan_date)}` : `Late · due ${shortDate(row.due_date)}`
}

function orderDueWords(row: CalendarMaterial["needs"][number]) {
  if (!row.production_plan_date || !row.job_card_no) return ""
  if (!row.order_due_date) return " · order has no delivery date"
  return row.order_due_date === row.production_plan_date ? "" : ` · order due ${shortDate(row.order_due_date)}`
}

/** SPEC2 answer 6: an order with no delivery date is never called "due"; it is counted from today. */
function sourceWords(row: Pick<CalendarMaterial["needs"][number], "source" | "no_date">) {
  if (row.no_date) {
    if (row.source === "RELEASED_QUEUE") return "Released card, not planned yet · order has no delivery date"
    if (row.source === "LINE_DUE" || row.source === "CUSTOMER_DELIVERY") return "Order line, no delivery date · not released"
    return "Order need, no delivery date"
  }
  switch (row.source) {
    case "PRODUCTION_PLAN": return "Planned on the floor"
    case "RELEASED_QUEUE": return "Released card, not planned yet"
    case "CUSTOMER_DELIVERY": return "Customer call-off, not released"
    case "LINE_DUE": return "Order line due, not released"
    case "AUTHORIZED_PENDING_RELEASE": return "Release waiting"
    default: return "Order need"
  }
}

/** One material for the window, or one day of it: need, arrivals, balance, who needs it. */
export function MaterialSheet({ open, onOpenChange, data, material, day, vendors, permissions, onNotice, onMoveConfirm }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  data: CalendarData
  material: CalendarMaterial | null
  day: string | null
  vendors: Vendor[]
  permissions: Permissions
  onNotice: (notice: Notice) => void
  onMoveConfirm: (arrival: Arrival, day: string, qtyValue?: number) => void
}) {
  const index = material && day ? data.days.indexOf(day) : -1
  const arrivals = useMemo(() => (material ? material.arrivals.filter((row) => !day || row.shown_date === day) : []), [material, day])
  const needs = useMemo(() => (material ? material.needs.filter((row) => !day || row.date === day) : []), [material, day])
  const timeline = useMemo(() => {
    if (!material) return []
    return data.days.map((date, position) => ({ date, position })).filter(({ date, position }) =>
      material.need[position] > 0 || material.arrivals.some((row) => row.shown_date === date) || (material.first_short?.date === date))
  }, [material, data.days])
  if (!material) return null
  const scale = balanceScale(material)
  return (
    <Sheet open={open} onOpenChange={onOpenChange} testId="rm-detail-sheet"
      eyebrow={<span>{CLASS_LABEL[material.material_class] || "Material"} · {material.item_code}</span>}
      title={day ? `${material.item_name} · ${dayLabel(day)}` : material.item_name}
      description={<CoverBadge material={material} weeks={data.weeks} today={data.today} cover={day && index >= 0 ? dayCoverWord(material, index, day, data.today) : undefined} />}>
      <div className="space-y-5">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-border bg-[hsl(var(--surface-2))] p-3.5 sm:grid-cols-4">
          {index >= 0 ? <>
            <StatPair label="Need that day" value={qty(material.need[index], material.uom)} tone={material.need[index] ? "amber" : "muted"} hint={material.late_need[index] ? `${qty(material.late_need[index], material.uom)} of it is late` : undefined} />
            <StatPair label="Arriving (counted)" value={<>{qty(material.arrive[index], material.uom)}{material.qc_in?.[index] ? <span className="block text-[11.5px] font-medium text-muted-foreground">+ {qty(material.qc_in[index], material.uom)} passing QC</span> : null}</>} />
            <StatPair label="Balance at day end" value={qty(material.balance[index], material.uom)} tone={material.balance[index] < 0 ? "rose" : material.min_stock && material.balance[index] < material.min_stock ? "amber" : "emerald"} />
            <StatPair label="If proposals approved" value={qty(material.balance_with_proposals[index], material.uom)} tone={material.balance_with_proposals[index] < 0 ? "rose" : "muted"} />
          </> : <>
            <StatPair label="Usable stock now" value={qty(material.stock_now, material.uom)} />
            <StatPair label="Waiting for QC" value={<>{qty(material.qc_pending, material.uom)}<span className="block text-[11.5px] font-medium text-muted-foreground">{material.qc_pending ? `counts from ${shortDate(material.qc_counts_from)}` : "incoming QC"}</span></>} tone="muted" />
            <StatPair label={`Need in ${data.weeks} weeks`} value={qty(material.totals.need, material.uom)} tone={material.totals.need ? "amber" : "muted"} hint={material.totals.late ? `${qty(material.totals.late, material.uom)} is late` : undefined} />
            <StatPair label="Arriving (counted)" value={qty(material.totals.arriving, material.uom)} />
          </>}
        </dl>
        {material.other_held ? <p className="-mt-3 text-[12px] text-muted-foreground">{qty(material.other_held, material.uom)} more is on hold (failed QC, held, or found in a count) and is not counted as cover.</p> : null}
        {material.min_stock ? <p className="-mt-3 text-[12px] text-muted-foreground">Minimum stock {qty(material.min_stock, material.uom)}{material.policy?.lead_time_days ? ` · lead time ${material.policy.lead_time_days} days` : ""}{material.policy?.minimum_order ? ` · minimum order ${qty(material.policy.minimum_order, material.uom)}` : ""}.</p> : null}

        <section aria-labelledby="rm-arrivals-title" className="space-y-2">
          <h3 id="rm-arrivals-title" className="flex items-center gap-2 text-[13.5px] font-semibold text-foreground"><Truck className="h-4 w-4 text-muted-foreground" aria-hidden="true" />Arrivals{day ? "" : ` in ${data.weeks} weeks`}</h3>
          {arrivals.length ? (
            <ul className="space-y-2">
              {arrivals.map((arrival) => <ArrivalRow key={arrival.id} arrival={arrival} material={material} data={data} vendors={vendors} permissions={permissions} onNotice={onNotice} onMoveConfirm={onMoveConfirm} />)}
            </ul>
          ) : <p className="rounded-lg border border-dashed border-border px-3 py-3 text-[12.5px] text-muted-foreground">No arrival {day ? "on this day" : "planned yet"}.</p>}
        </section>

        {permissions.canPropose ? <ArrivalForm data={data} material={material} defaultDate={day || undefined} vendors={vendors} permissions={permissions} onDone={onNotice} /> : null}

        <section aria-labelledby="rm-needs-title" className="space-y-2">
          <h3 id="rm-needs-title" className="flex items-center gap-2 text-[13.5px] font-semibold text-foreground"><ClipboardList className="h-4 w-4 text-muted-foreground" aria-hidden="true" />Who needs it{day ? " that day" : ""}</h3>
          <NeedList material={material} rows={needs} today={data.today} />
        </section>

        {!day && timeline.length ? (
          <section aria-labelledby="rm-timeline-title" className="space-y-2">
            <h3 id="rm-timeline-title" className="flex items-center gap-2 text-[13.5px] font-semibold text-foreground"><CalendarClock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />Day by day</h3>
            <ol className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
              {timeline.map(({ date, position }) => (
                <li key={date} className={cn("grid grid-cols-[88px_minmax(0,1fr)] items-center gap-3 px-3 py-2", material.balance[position] < 0 && "bg-signal-rose-soft/50")}>
                  <span className="text-[12.5px] font-semibold text-foreground">{relativeDay(date, data.today)}</span>
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
                      {material.need[position] ? <span className="font-semibold text-signal-amber-ink">Need {qty(material.need[position], material.uom)}</span> : null}
                      {material.arrivals.filter((row) => row.shown_date === date).map((row) => <ArrivalChip key={row.id} arrival={row} uom={material.uom} />)}
                    </div>
                    <BalanceBar value={material.balance[position]} scale={scale} minimum={material.min_stock} uom={material.uom} />
                  </div>
                </li>
              ))}
            </ol>
          </section>
        ) : null}
        <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          {material.last_vendor ? <>Last approved PO: {material.last_vendor.supplier_name} at {rateText(material.last_vendor.rate, material.uom)} ({material.last_vendor.po_no}).</> : "No Owner-approved PO for it yet: a scheduled draft takes the RM costing rate, or says “rate needed”."}
          <Link className="inline-flex items-center gap-1 font-semibold text-signal-cyan-ink hover:underline" href={`/purchase?q=${encodeURIComponent(material.item_code)}`}>POs<ExternalLink className="h-3 w-3" aria-hidden="true" /></Link>
        </p>
      </div>
    </Sheet>
  )
}

/** Every material with something on one day (from the Month view). */
export function DaySheet({ open, onOpenChange, data, day, materials, onPick }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  data: CalendarData
  day: string | null
  materials: CalendarMaterial[]
  onPick: (material: CalendarMaterial, day: string) => void
}) {
  if (!day) return null
  const position = data.days.indexOf(day)
  const rows = materials.filter((row) => position >= 0 && (row.need[position] > 0 || row.arrivals.some((arrival) => arrival.shown_date === day) || row.balance[position] < 0))
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={dayLabel(day)} eyebrow={relativeDay(day, data.today) === dayLabel(day) ? longDate(day) : relativeDay(day, data.today)}
      description={`${rows.length} material${rows.length === 1 ? "" : "s"} with need, arrivals or a shortage`} testId="rm-day-sheet">
      {rows.length ? (
        <ul className="space-y-2">
          {rows.map((material) => {
            const arrivals = material.arrivals.filter((row) => row.shown_date === day)
            const balance = material.balance[position]
            return (
              <li key={material.item_id}>
                <button type="button" onClick={() => onPick(material, day)} className="w-full rounded-xl border border-border bg-card p-3 text-left transition-colors hover:border-signal-cyan-line focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-[13.5px] font-semibold text-foreground">{material.item_name}</p>
                      <p className="text-[12px] text-muted-foreground">{material.item_code}</p>
                    </div>
                    <span className={cn("shrink-0 text-[12.5px] font-semibold tabular-nums", balance < 0 ? "text-signal-rose-ink" : "text-muted-foreground")}>{balance < 0 ? `Short ${qty(-balance, material.uom)}` : `Left ${qty(balance, material.uom)}`}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px]">
                    {material.need[position] ? <span className="font-semibold text-signal-amber-ink">Need {qty(material.need[position], material.uom)}</span> : null}
                    {arrivals.map((row) => <ArrivalChip key={row.id} arrival={row} uom={material.uom} />)}
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      ) : <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-[13px] text-muted-foreground">Nothing needed or arriving on this day.</p>}
    </Sheet>
  )
}
