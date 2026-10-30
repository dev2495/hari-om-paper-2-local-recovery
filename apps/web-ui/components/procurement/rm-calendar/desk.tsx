"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { CalendarCheck2, CalendarClock, CheckCircle2, Download, FileText, Mail, MessageCircle, PackageCheck, Printer, Send, Share2, Sparkles, Truck } from "lucide-react"

import { Field, MessageBar, areaClass, fieldClass, primaryButton, secondaryButton } from "@/components/procurement/procurement-shell"
import { useSendOrder, useVendorConfirm } from "@/hooks/use-rm-calendar"
import { apiErrorText, rmCalendarApi, type DeskOrder, type SendChannel } from "@/lib/api-rm-calendar"
import { cn } from "@/lib/utils"

import { deliveryRows, vendorMessage, vendorPhone, type DeliveryRow } from "./desk-text"
import { CHANNEL_LABEL, istDateTime, istDay, longDate, personName, qty, shortDate } from "./format"
import { businessDate } from "@/lib/business-date"

export { deliveryRows, vendorMessage }
import { Sheet } from "./sheet"

const SOURCE_META: Record<string, { label: string; className: string }> = {
  SCHEDULE: { label: "Scheduled by Owner", className: "border-signal-violet-line bg-signal-violet-soft text-signal-violet-ink" },
  REQUISITION: { label: "Requisition", className: "border-signal-amber-line bg-signal-amber-soft text-signal-amber-ink" },
  WORKBOOK: { label: "Workbook import", className: "border-border bg-muted text-muted-foreground" },
  PLAN: { label: "Month plan", className: "border-border bg-muted text-muted-foreground" },
  MANUAL: { label: "Hand-made", className: "border-border bg-card text-muted-foreground" },
}

export function SourceBadge({ order, className }: { order: Pick<DeskOrder, "source" | "scheduled_at">; className?: string }) {
  const meta = SOURCE_META[order.source || "MANUAL"] || SOURCE_META.MANUAL
  const day = order.source === "SCHEDULE" ? istDay(order.scheduled_at) : null
  return (
    <span className={cn("inline-flex h-[22px] max-w-full items-center gap-1 rounded-md border px-1.5 text-[11px] font-semibold", meta.className, className)}>
      {order.source === "SCHEDULE" ? <Sparkles className="h-3 w-3 shrink-0" aria-hidden="true" /> : null}
      <span className="truncate">{meta.label}{day ? ` · ${shortDate(day)}` : ""}</span>
    </span>
  )
}

export function SentChip({ order }: { order: DeskOrder }) {
  if (!order.sent_at) return null
  return (
    <span className="inline-flex h-[22px] items-center gap-1 rounded-md border border-signal-blue-line bg-signal-blue-soft px-1.5 text-[11px] font-semibold text-signal-blue-ink">
      <Send className="h-3 w-3" aria-hidden="true" />Sent on {CHANNEL_LABEL[order.sent_channel || ""] || "—"} · {shortDate(istDay(order.sent_at))}
    </span>
  )
}

/** "Scheduled by Owner Harish on 28 Oct · 3 arrivals (30 Oct, 4 Nov, 6 Nov)" and how it was approved. */
export function ScheduledBanner({ order }: { order: DeskOrder }) {
  const rows = deliveryRows(order)
  if (order.source !== "SCHEDULE") return null
  const dates = Array.from(new Set(rows.map((row) => row.date))).map(shortDate)
  const check = order.send_check
  // A dates-only revision of a sent PO (or a desk revision) clears the send: it must go again.
  const resend = Boolean(order.metadata_json?.resend_reason) && !order.sent_at
  return (
    <section className="flex flex-wrap items-start gap-3 rounded-xl border border-signal-violet-line bg-signal-violet-soft/70 px-4 py-3 text-signal-violet-ink" data-testid="po-scheduled-banner">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-card/70"><Sparkles className="h-4 w-4" aria-hidden="true" /></span>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-semibold">Scheduled by {order.scheduled_by ? `the Owner, ${personName(order.scheduled_by)},` : "the Owner"} on {longDate(istDay(order.scheduled_at))}</p>
        <p className="mt-0.5 text-[12.5px] leading-5 opacity-90">
          {rows.length} arrival{rows.length === 1 ? "" : "s"}{dates.length ? ` (${dates.slice(0, 6).join(", ")}${dates.length > 6 ? "…" : ""})` : ""}.
          {order.approval_source === "SCHEDULE" ? (order.sent_at && !resend ? " Approved by the Owner on the RM inward calendar and sent unchanged."
            : resend ? ` Approved by the Owner on the RM inward calendar. The delivery dates changed since, so revision ${order.current_revision_no} has to go to the vendor again.`
            : " Approved by the Owner on the RM inward calendar; not sent yet.") : null}
          {order.status === "DRAFT" && check?.mode === "SEND_ON_SCHEDULE" ? " Nothing changed since the Owner approved it, so it goes to the vendor without a second approval." : null}
          {order.status === "DRAFT" && check?.mode === "SUBMIT_FOR_APPROVAL" ? (rateNames(order).length
            ? ` Fill the rate for ${rateNames(order).join(", ")} (Edit / vendor change).${check.changes?.length ? " It then goes to the Owner for approval." : ""}`
            : " It needs the Owner's approval before it goes to the vendor.") : null}
        </p>
        {order.status === "DRAFT" && check?.changes?.length ? (
          <div className="mt-2 rounded-lg bg-card/70 px-3 py-2 text-signal-amber-ink">
            <p className="text-[12px] font-semibold">Changed since the Owner approved it</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[12.5px] leading-5">{check.changes.map((change) => <li key={change}>{change}</li>)}</ul>
          </div>
        ) : null}
      </div>
    </section>
  )
}

/** Delivery dates per line; the desk records the vendor's confirmed date per row. */
export function DeliveryDates({ order, canConfirm, onNotice }: { order: DeskOrder; canConfirm: boolean; onNotice: (tone: "success" | "error", text: string) => void }) {
  const rows = useMemo(() => deliveryRows(order), [order])
  const today = businessDate()
  const [dates, setDates] = useState<Record<string, string>>({})
  const confirm = useVendorConfirm()
  const confirmable = canConfirm && ["APPROVED", "PARTIALLY_RECEIVED"].includes(order.status)
  const toConfirm = rows.filter((row) => row.confirmation !== "CONFIRMED" && row.open > 0)
  async function run(target: DeliveryRow[]) {
    try {
      // A vendor's date is today or later; an overdue row is confirmed for today unless a day is picked.
      await confirm.mutateAsync({ id: order.id, version: order.version, rows: target.map((row) => ({ schedule_id: row.id, confirmed_date: dates[row.id] || (row.date < today ? today : row.date) })) })
      onNotice("success", `Vendor confirmation saved for ${target.length} delivery date${target.length === 1 ? "" : "s"}.`)
    } catch (failure) { onNotice("error", apiErrorText(failure)) }
  }
  if (!rows.length) {
    return <p className="rounded-lg border border-dashed border-border px-3 py-4 text-[13px] text-muted-foreground">No dated delivery yet. {["APPROVED", "PARTIALLY_RECEIVED"].includes(order.status) ? <Link href="/purchase/supplier-deliveries" className="font-semibold text-signal-cyan-ink hover:underline">Add one in Expected arrivals</Link> : "Dates come from the PO expected date or the RM inward calendar."}</p>
  }
  return (
    <div className="space-y-3" data-testid="po-delivery-dates">
      {confirmable && toConfirm.length ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-signal-cyan-line bg-signal-cyan-soft/60 px-3 py-2 text-[12.5px] text-signal-cyan-ink">
          <span>{order.sent_at ? "When the vendor replies, record the dates they confirm." : "Send the PO first; then record the dates the vendor confirms."}</span>
          <button type="button" className={cn(primaryButton, "max-sm:h-11")} disabled={confirm.isPending} onClick={() => run(toConfirm)}>
            <CalendarCheck2 className="h-4 w-4" aria-hidden="true" />Vendor confirmed all ({toConfirm.length})
          </button>
        </div>
      ) : null}
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {rows.map((row) => {
          const received = row.open <= 0.0005 && row.received > 0
          return (
            <li key={row.id} className="grid gap-2 px-3 py-3 sm:grid-cols-[112px_minmax(0,1fr)_auto] sm:items-center">
              <div>
                <p className="text-[13.5px] font-semibold text-foreground">{longDate(row.date)}</p>
                {row.promised_date && row.promised_date !== row.date ? <p className="text-[11.5px] text-muted-foreground">was {shortDate(row.promised_date)}</p> : null}
              </div>
              <div className="min-w-0">
                <p className="truncate text-[13px] font-semibold text-foreground">{row.item_name || row.item_code} <span className="font-normal text-muted-foreground">· {row.item_code}</span></p>
                <p className="text-[12px] text-muted-foreground">
                  {qty(row.qty, row.uom)}{row.received ? ` · ${qty(row.received, row.uom)} received` : ""}{row.open > 0 && row.received ? ` · ${qty(row.open, row.uom)} to come` : ""}
                  {row.from_calendar ? " · from the RM inward calendar" : ""}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                {received ? <span className="inline-flex items-center gap-1 rounded-md bg-signal-emerald-soft px-1.5 py-0.5 text-[11.5px] font-semibold text-signal-emerald-ink"><PackageCheck className="h-3.5 w-3.5" aria-hidden="true" />Received</span>
                  : row.confirmation === "CONFIRMED" ? <span className="inline-flex items-center gap-1 rounded-md bg-signal-indigo-soft px-1.5 py-0.5 text-[11.5px] font-semibold text-signal-indigo-ink"><CalendarCheck2 className="h-3.5 w-3.5" aria-hidden="true" />Confirmed</span>
                  : <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11.5px] font-semibold text-muted-foreground"><CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />To confirm</span>}
                {confirmable && !received && row.confirmation !== "CONFIRMED" ? (
                  <span className="flex items-center gap-1.5">
                    <input aria-label={`Confirmed date for ${row.item_name || row.item_code}`} type="date" min={today} className={cn(fieldClass, "w-[150px] max-sm:h-11")} value={dates[row.id] || (row.date < today ? today : row.date)} onChange={(event) => setDates({ ...dates, [row.id]: event.target.value })} />
                    <button type="button" className={cn(secondaryButton, "max-sm:h-11")} disabled={confirm.isPending} onClick={() => run([row])}>Confirm</button>
                  </span>
                ) : null}
                {["APPROVED", "PARTIALLY_RECEIVED"].includes(order.status) && row.open > 0 ? (
                  <Link className={cn(secondaryButton, "max-sm:h-11")} href={`/purchase/inward?po=${order.id}&line=${row.line_id}`}><Truck className="h-4 w-4" aria-hidden="true" />Make GRN</Link>
                ) : null}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function download(file: File) {
  const url = URL.createObjectURL(file)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = file.name
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/**
 * Send to vendor. The server first approves an unchanged scheduled draft on the Owner's schedule
 * approval and stamps who sent it, when and how; then the saved PDF goes out:
 * WhatsApp shares the PDF file on a phone (else downloads it and opens wa.me), email opens a
 * prefilled message and downloads the PDF, PDF downloads it, print prints this page.
 */
export function SendSheet({ open, onOpenChange, order, vendor, onSent }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  order: DeskOrder
  vendor?: { contact_phone?: string | null; alt_phone?: string | null; contact_email?: string | null } | null
  onSent: (order: DeskOrder, channel: SendChannel) => void
}) {
  const send = useSendOrder()
  const [error, setError] = useState("")
  const [ready, setReady] = useState<{ channel: SendChannel; file: File; order: DeskOrder; canShare: boolean } | null>(null)
  const phone = vendorPhone(vendor?.contact_phone || vendor?.alt_phone)
  const email = vendor?.contact_email || ""
  const check = order.send_check
  const onSchedule = check?.mode === "SEND_ON_SCHEDULE"
  const resend = Boolean(order.sent_at)

  async function go(channel: SendChannel) {
    setError("")
    setReady(null)
    try {
      const sent = await send.mutateAsync({ id: order.id, version: order.version, channel })
      onSent(sent, channel)
      if (channel === "PRINT") { onOpenChange(false); window.setTimeout(() => window.print(), 300); return }
      const file = await rmCalendarApi.pdfFile(sent)
      const phoneLike = window.matchMedia("(pointer: coarse)").matches
      const canShare = channel === "WHATSAPP" && phoneLike && typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })
      if (!canShare) download(file)
      setReady({ channel, file, order: sent, canShare })
    } catch (failure) {
      setError(apiErrorText(failure))
    }
  }

  async function record(channel: SendChannel) {
    setError("")
    try {
      const sent = await send.mutateAsync({ id: order.id, version: order.version, channel, note: "Sent outside TubeOS; recorded later" })
      onSent(sent, channel)
      onOpenChange(false)
    } catch (failure) {
      setError(apiErrorText(failure))
    }
  }

  const message = vendorMessage(ready?.order || order)
  return (
    <Sheet open={open} onOpenChange={(next) => { onOpenChange(next); if (!next) { setReady(null); setError("") } }} testId="po-send-sheet"
      eyebrow={`${order.po_no} · ${order.supplier_name}`} title={ready ? "Sent to the vendor" : resend ? "Send to the vendor again" : "Send to vendor"}
      description={ready ? "Finish here: share or attach the PDF. Record the vendor's confirmed dates on the PO when they reply." : onSchedule ? "The Owner approved these arrivals and nothing changed, so sending also approves the PO on the Owner's schedule approval." : "The PO is approved. Pick how it goes to the vendor; the send is recorded with your name and the time."}>
      {error ? <div className="mb-3"><MessageBar tone="error">{error}</MessageBar></div> : null}
      {ready ? (
        <div className="space-y-3">
          <MessageBar tone="success">{ready.order.po_no} marked sent on {CHANNEL_LABEL[ready.channel]} by you. {ready.canShare ? "Tap Share to pick WhatsApp." : "The PDF was downloaded."}</MessageBar>
          {ready.channel === "WHATSAPP" ? (
            ready.canShare ? (
              <button type="button" className={cn(primaryButton, "!h-12 w-full text-[14px]")} onClick={() => navigator.share({ files: [ready.file], title: ready.order.po_no, text: message }).catch(() => undefined)}>
                <Share2 className="h-5 w-5" aria-hidden="true" />Share PDF on WhatsApp
              </button>
            ) : (
              <a className={cn(primaryButton, "!h-12 w-full text-[14px]")} href={`https://wa.me/${phone}?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer">
                <MessageCircle className="h-5 w-5" aria-hidden="true" />Open WhatsApp{phone ? "" : " (pick the contact)"} and attach the PDF
              </a>
            )
          ) : null}
          {ready.channel === "EMAIL" ? (
            <a className={cn(primaryButton, "!h-12 w-full text-[14px]")} href={`mailto:${email}?subject=${encodeURIComponent(`Purchase order ${ready.order.po_no}`)}&body=${encodeURIComponent(message)}`}>
              <Mail className="h-5 w-5" aria-hidden="true" />Open email{email ? ` to ${email}` : ""} and attach the PDF
            </a>
          ) : null}
          <button type="button" className={cn(secondaryButton, "!h-11 w-full")} onClick={() => download(ready.file)}><Download className="h-4 w-4" aria-hidden="true" />Download the PDF again</button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {([
              { channel: "WHATSAPP" as const, icon: MessageCircle, label: "WhatsApp", hint: phone ? `+${phone}` : "pick the contact" },
              { channel: "EMAIL" as const, icon: Mail, label: "Email", hint: email || "no email in vendor master" },
              { channel: "PDF" as const, icon: FileText, label: "Download PDF", hint: "hand over or upload" },
              { channel: "PRINT" as const, icon: Printer, label: "Print", hint: "printed copy" },
            ]).map((option) => (
              <button key={option.channel} type="button" disabled={send.isPending} onClick={() => go(option.channel)}
                className="flex min-h-[76px] flex-col items-start justify-center gap-1 rounded-xl border border-border bg-card px-3 py-2.5 text-left transition-colors hover:border-signal-cyan-line hover:bg-signal-cyan-soft/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60">
                <span className="flex items-center gap-2 text-[13.5px] font-semibold text-foreground"><option.icon className="h-4 w-4 text-signal-cyan-ink" aria-hidden="true" />{option.label}</span>
                <span className="truncate text-[11.5px] text-muted-foreground">{option.hint}</span>
              </button>
            ))}
          </div>
          {send.isPending ? <p className="text-[12.5px] text-muted-foreground" role="status">Recording the send…</p> : null}
          <Field label="Message the vendor gets">
            <textarea readOnly rows={6} className={cn(areaClass, "min-h-[132px] resize-y leading-5")} value={message} />
          </Field>
          {resend ? <p className="text-[12px] text-muted-foreground">Last sent on {CHANNEL_LABEL[order.sent_channel || ""]} by {personName(order.sent_by)} on {istDateTime(order.sent_at)}.</p> : null}
          {!resend && ["APPROVED", "PARTIALLY_RECEIVED"].includes(order.status) ? (
            <details className="rounded-lg border border-border bg-[hsl(var(--surface-2))] px-3 py-2">
              <summary className="flex min-h-[36px] cursor-pointer list-none items-center text-[12.5px] font-semibold text-foreground max-sm:min-h-11">Already sent it outside TubeOS? Record it</summary>
              <p className="mt-1 text-[12px] leading-5 text-muted-foreground">Nothing is downloaded or opened: this only notes that the vendor has the PO, with your name and the time.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {(["WHATSAPP", "EMAIL", "PDF", "PRINT"] as const).map((channel) => (
                  <button key={channel} type="button" className={cn(secondaryButton, "max-sm:h-11")} disabled={send.isPending} onClick={() => record(channel)}>
                    Sent on {CHANNEL_LABEL[channel]}
                  </button>
                ))}
              </div>
            </details>
          ) : null}
        </div>
      )}
    </Sheet>
  )
}

/** Short summary of what a scheduled draft carries, for queue cards. */
export function OrderFacts({ order }: { order: DeskOrder }) {
  const rows = deliveryRows(order)
  const units = (order.lines || []).reduce((totals, line) => ({ ...totals, [line.uom]: (totals[line.uom] || 0) + Number(line.qty_ordered || 0) }), {} as Record<string, number>)
  const dates = Array.from(new Set(rows.filter((row) => row.open > 0).map((row) => row.date)))
  const rateNeeded = order.send_check?.rate_needed || []
  return (
    <p className="text-[12.5px] leading-5 text-muted-foreground">
      {Object.entries(units).map(([uom, value]) => qty(value, uom)).join(" · ")} · {order.lines.length} material{order.lines.length === 1 ? "" : "s"}
      {dates.length ? ` · arrives ${dates.slice(0, 4).map(shortDate).join(", ")}${dates.length > 4 ? "…" : ""}` : ""}
      {rateNeeded.length ? <span className="font-semibold text-signal-amber-ink"> · rate needed for {rateNames(order).join(", ")}</span> : null}
    </p>
  )
}

/** Materials on the PO that still have no rate, by name (codes are not words). */
export function rateNames(order: DeskOrder): string[] {
  const names = order.send_check?.rate_needed_names
  if (names?.length) return names
  return (order.lines || []).filter((line) => !(Number(line.unit_cost) > 0)).map((line) => line.item_name || line.item_code)
}

export function SendStateWords({ order }: { order: DeskOrder }) {
  const check = order.send_check
  if (order.sent_at) return <span className="inline-flex items-center gap-1 text-[12px] font-medium text-signal-blue-ink"><Send className="h-3.5 w-3.5" aria-hidden="true" />Sent {istDateTime(order.sent_at)} by {personName(order.sent_by)}</span>
  if (check?.mode === "SEND_ON_SCHEDULE") return <span className="inline-flex items-center gap-1 text-[12px] font-medium text-signal-emerald-ink"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />Unchanged since the Owner approved: ready to send</span>
  if (order.status === "REJECTED" || order.status === "REVISION_REQUIRED") return <span className="text-[12px] font-medium text-signal-rose-ink">Sent back by the Owner: revise it, or cancel it</span>
  if (check?.mode === "SUBMIT_FOR_APPROVAL") return <span className="text-[12px] font-medium text-signal-amber-ink">{rateNames(order).length ? `Rate needed for ${rateNames(order).join(", ")}` : check.changes?.length ? `Changed since the Owner approved it (${check.changes.length})` : "Needs the Owner's approval"}</span>
  if (check?.mode === "WAITING_APPROVAL") return <span className="text-[12px] font-medium text-signal-amber-ink">Waiting for the Owner&apos;s approval</span>
  if (check?.mode === "SEND") return <span className="text-[12px] font-medium text-signal-cyan-ink">{order.metadata_json?.resend_reason ? `Revision ${order.current_revision_no} approved; send it again` : "Approved, not sent yet"}</span>
  return null
}
