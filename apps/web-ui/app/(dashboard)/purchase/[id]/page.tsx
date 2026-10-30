"use client"

import Link from "next/link"
import { useState } from "react"
import { useParams } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Ban, CheckCircle2, ChevronDown, Clock3, IndianRupee, PackageCheck, PencilLine, Printer, Send, XCircle } from "lucide-react"

import { DeliveryDates, ScheduledBanner, SendSheet, SendStateWords, SentChip, SourceBadge, deliveryRows, rateNames } from "@/components/procurement/rm-calendar/desk"
import { CHANNEL_LABEL, istDateTime, istDay, longDate, personName, qty as qtyText, rateText } from "@/components/procurement/rm-calendar/format"
import type { DeskOrder } from "@/lib/api-rm-calendar"
import { canDecideOrder } from "@/components/procurement/rm-calendar/desk-text"

import { EmptyState } from "@/components/erp/shell"
import { Field, MessageBar, ProcurementShell, QuantityLotStrip, StateBadge, WorkPanel, fieldClass, primaryButton, secondaryButton, stateWord } from "@/components/procurement/procurement-shell"
import { cn } from "@/lib/utils"
import { useAuth } from "@/context/AuthContext"
import { useVendors } from "@/hooks/use-master-data"
import { purchaseApi } from "@/lib/api"
import type { PurchaseOrder } from "@/lib/procurement-types"

// Drafts made before 28 Oct 2026 say "the dated schedule below", but the dates print above the terms.
const deliveryTerms = (value?: string | null) => (value && value.includes("dated schedule below") ? "Delivery on the dates in the delivery schedule above." : value || "As agreed")
const indianDate = (value?: string | null) => (value ? new Date(`${String(value).slice(0, 10)}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "")

/** A short "Why?" disclosure, so the approval card shows status first and the rules only on request. */
function WhyNote({ title = "Why?", children }: { title?: string; children: React.ReactNode }) {
  return (
    <details className="group rounded-lg border border-border bg-[hsl(var(--surface-2))] px-3">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-[13px] font-semibold text-signal-cyan-ink sm:min-h-9">
        <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />{title}
      </summary>
      <p className="pb-3 text-[13px] leading-5 text-muted-foreground">{children}</p>
    </details>
  )
}

export default function PurchaseOrderDetailPage() {
  const params = useParams<{ id: string }>()
  const { activePlant, user } = useAuth()
  const roles = new Set([user?.role, ...(user?.roles || [])].filter(Boolean) as string[])
  const isOwner = roles.has("Owner")
  const has = (...names: string[]) => names.some((role) => roles.has(role))
  // Spec 2.8 and the server's own checks: the purchase desk sends the PO and records the vendor's
  // confirmation (Admin alone is not on the desk); revisions and submit are the desk's (Owner and
  // Admin pass); only the plant head or the Owner cancels or short-closes.
  const canSend = has("Store", "Planner", "PlantManager", "Owner")
  const canRevise = has("Store", "Planner", "PlantManager", "Owner", "Admin")
  const canClose = has("PlantManager", "Owner", "Admin")
  const [sendOpen, setSendOpen] = useState(false)
  const queryClient = useQueryClient()
  const [reason, setReason] = useState("")
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null)
  const orderQuery = useQuery({ queryKey: ["purchase-v2", "order", activePlant, params.id], queryFn: () => purchaseApi.getOrder(params.id), enabled: Boolean(activePlant && activePlant !== "ALL") && Boolean(params.id) })
  const order = orderQuery.data?.data as (PurchaseOrder & DeskOrder) | undefined
  const vendorsQuery = useVendors({ include_inactive: true })
  const history = useQuery({ queryKey: ["purchase-v2", "history", params.id, activePlant], queryFn: () => purchaseApi.getOrderHistory(params.id), enabled: Boolean(activePlant && activePlant !== "ALL") && Boolean(order) })

  const refresh = () => { queryClient.invalidateQueries({ queryKey: ["purchase-v2"] }); queryClient.invalidateQueries({ queryKey: ["purchase"] }) }
  const submit = useMutation({ mutationFn: () => purchaseApi.submitOrder(params.id, { expected_version: order?.version, reason: reason || "Ready for commercial approval" }), onSuccess: () => { setNotice({ tone: "success", text: "Revision submitted for independent approval." }); refresh() }, onError: (error: any) => setNotice({ tone: "error", text: error?.response?.data?.detail || error.message }) })
  const shortClose = useMutation({ mutationFn: () => purchaseApi.shortCloseOrder(order!.id, { expected_version: order!.version, reason, lines: [] }), onSuccess: () => { setNotice({ tone: "success", text: "All remaining quantities were short-closed with the saved reason." }); setReason(""); refresh() }, onError: (error: any) => setNotice({ tone: "error", text: error?.response?.data?.detail || error.message }) })
  const approve = useMutation({ mutationFn: () => purchaseApi.approveOrder(order!.id, { expected_version: order!.version, reason: reason || "Commercial terms verified" }), onSuccess: () => { setNotice({ tone: "success", text: "Purchase order approved. The desk sends it to the vendor next; GRN can receive against it." }); setReason(""); refresh() }, onError: (error: any) => setNotice({ tone: "error", text: error?.response?.data?.detail || error.message }) })
  const reject = useMutation({ mutationFn: () => purchaseApi.rejectOrder(order!.id, { expected_version: order!.version, reason }), onSuccess: () => { setNotice({ tone: "success", text: "Revision sent back with your reason." }); setReason(""); refresh() }, onError: (error: any) => setNotice({ tone: "error", text: error?.response?.data?.detail || error.message }) })
  const cancel = useMutation({ mutationFn: () => purchaseApi.cancelOrder(order!.id, { expected_version: order!.version, reason }), onSuccess: () => { setNotice({ tone: "success", text: "Unreceived purchase order cancelled with history preserved." }); setReason(""); refresh() }, onError: (error: any) => setNotice({ tone: "error", text: error?.response?.data?.detail || error.message }) })

  if (!activePlant || activePlant === "ALL") return <ProcurementShell eyebrow="Purchasing" title="Purchase order" description="Select the purchase order plant.">{null}</ProcurementShell>
  if (orderQuery.isLoading) return <div className="h-72 animate-pulse rounded-xl bg-muted" />
  if (!order) return <EmptyState label="Purchase order not found in this plant." />
  const total = order.lines.reduce((sum, line) => sum + line.qty_ordered * line.unit_cost, 0)
  const rateNeeded = order.send_check?.rate_needed || []
  // The server's maker-checker rule: never show Approve / Reject it would refuse. A scheduled PO is the
  // Owner's own decision, so he may approve a changed draft straight away (no Submit step).
  const canDecide = isOwner && canDecideOrder(order, user?.email)
  const ownerApprovesDraft = isOwner && order.status === "DRAFT" && order.source === "SCHEDULE" && order.send_check?.mode === "SUBMIT_FOR_APPROVAL" && !rateNeeded.length
  const changes = order.send_check?.changes || []
  const otherReasons = (order.send_check?.reasons || []).filter((reason) => !changes.includes(reason))
  const quantityByUnit = (basis: "ordered" | "received" | "open") => Object.entries(order.lines.reduce((totals, line) => {
    const quantity = basis === "ordered" ? line.qty_ordered : basis === "received" ? line.qty_received : Math.max(0, line.qty_ordered - line.qty_received - (line.qty_short_closed || 0))
    totals[line.uom] = (totals[line.uom] || 0) + quantity
    return totals
  }, {} as Record<string, number>)).map(([unit, value]) => qtyText(value, unit)).join(" + ")
  // Supplier block: what this revision saved (vendor master details are snapshotted with the GSTIN).
  const saved: Record<string, any> = { ...((order as any).metadata_json || {}), ...(order as any) }
  const masterVendor: any = (Array.isArray(vendorsQuery.data) ? vendorsQuery.data : []).find((row: any) => String(row.id) === String(order.supplier_id))
  const supplierFacts = [
    saved.supplier_gst_no ? ["GSTIN", saved.supplier_gst_no] : null,
    saved.supplier_pan_no ? ["PAN", saved.supplier_pan_no] : null,
    saved.supplier_state ? ["State", `${saved.supplier_state}${saved.supplier_state_code ? ` (${saved.supplier_state_code})` : ""}`] : null,
    saved.supplier_msme_no ? ["MSME", saved.supplier_msme_no] : null,
    saved.supplier_contact ? ["Contact", saved.supplier_contact] : null,
    saved.supplier_phone && !String(saved.supplier_contact || "").includes(String(saved.supplier_phone).split(" / ")[0]) ? ["Phone", saved.supplier_phone] : null,
    saved.supplier_email ? ["Email", saved.supplier_email] : null,
  ].filter(Boolean) as [string, string][]
  const masterGstMissing = !saved.supplier_gst_no && masterVendor?.gst_no
  // The signatories the saved PDF prints: who made this revision and who approved it (names, not logins).
  const shownRevision: any = (history.data?.data?.items || []).find((row: any) => Number(row.revision_no) === Number(order.current_revision_no))
  const preparedBy = shownRevision?.created_by ? personName(shownRevision.created_by) : null
  const approvedBy = shownRevision?.approved_by ? `Approved by ${personName(shownRevision.approved_by)}${shownRevision.approved_at ? ` on ${longDate(istDay(shownRevision.approved_at))}` : ""}` : "Approval pending"
  const pricedLines = order.lines.filter((line) => line.unit_cost > 0).length
  const missingRates = order.lines.length - pricedLines
  const expectedLots = order.lines.some((line) => line.expected_unit_count !== null && line.expected_unit_count !== undefined)
    ? order.lines.reduce((sum, line) => sum + Number(line.expected_unit_count || 0), 0)
    : null

  return (
    <ProcurementShell eyebrow={`${order.po_no} · Revision ${order.current_revision_no}`} title={`${order.supplier_name} purchase order`}
      description="What the vendor gets. Send it, print it or change it here."
      actions={<>
        {order.status === "DRAFT" && order.send_check?.mode === "SEND_ON_SCHEDULE" && canSend ? <button type="button" className={primaryButton} onClick={() => setSendOpen(true)} data-testid="po-send-button"><Send className="h-4 w-4" /> Send to vendor</button> : null}
        {order.status === "DRAFT" && order.send_check?.mode !== "SEND_ON_SCHEDULE" && rateNeeded.length && canRevise ? <Link className={primaryButton} href={`/purchase/${order.id}/edit`} data-testid="po-fill-rate"><IndianRupee className="h-4 w-4" /> Fill the rate</Link> : null}
        {ownerApprovesDraft ? <button type="button" className={primaryButton} disabled={approve.isPending} onClick={() => approve.mutate()} data-testid="po-owner-approve"><CheckCircle2 className="h-4 w-4" /> Approve PO</button> : null}
        {order.status === "DRAFT" && order.send_check?.mode !== "SEND_ON_SCHEDULE" && !rateNeeded.length && canRevise && !ownerApprovesDraft ? <button type="button" className={primaryButton} disabled={submit.isPending} onClick={() => submit.mutate()}><Send className="h-4 w-4" /> Submit for approval</button> : null}
        {['APPROVED','PARTIALLY_RECEIVED'].includes(order.status) && canSend ? <button type="button" className={order.sent_at ? secondaryButton : primaryButton} onClick={() => setSendOpen(true)} data-testid="po-send-button"><Send className="h-4 w-4" /> {order.sent_at ? "Send again" : "Send to vendor"}</button> : null}
        {order.status === "SUBMITTED" && canDecide ? <button type="button" className={primaryButton} disabled={approve.isPending} onClick={() => approve.mutate()}><CheckCircle2 className="h-4 w-4" /> Approve PO</button> : null}
        {order.status === "SUBMITTED" && !canDecide ? <span className="rounded-lg border border-signal-amber-line bg-signal-amber-soft px-3 py-2 text-[12.5px] font-medium text-signal-amber-ink">{isOwner ? "You prepared this revision: another Owner approves it" : "Waiting for Owner approval"}</span> : null}
        {['APPROVED','PARTIALLY_RECEIVED'].includes(order.status) ? <Link className={order.sent_at ? primaryButton : secondaryButton} href={`/purchase/inward?po=${order.id}&vendor=${order.supplier_id}`}><PackageCheck className="h-4 w-4" /> Receive goods (GRN)</Link> : null}
        <button type="button" className={secondaryButton} onClick={() => window.print()}><Printer className="h-4 w-4" /> Print PO</button>
        <a className={secondaryButton} href={purchaseApi.orderPdfUrl(order.id, order.current_revision_no)} target="_blank" rel="noreferrer">Saved PDF</a>
        {!['RECEIVED','CANCELLED','SHORT_CLOSED'].includes(order.status) && canRevise && !(order.status === "DRAFT" && rateNeeded.length) ? <Link className={secondaryButton} href={`/purchase/${order.id}/edit`}><PencilLine className="h-4 w-4" /> Edit / vendor change</Link> : null}
      </>}>
      {notice ? <MessageBar tone={notice.tone}>{notice.text}</MessageBar> : null}
      <div className="flex flex-wrap items-center gap-2">
        <SourceBadge order={order} />
        <SentChip order={order} />
        {order.vendor_confirmed_at ? <span className="inline-flex h-[22px] items-center rounded-md border border-signal-indigo-line bg-signal-indigo-soft px-1.5 text-[11px] font-semibold text-signal-indigo-ink">Vendor confirmed · {personName(order.vendor_confirmed_by)}</span> : null}
        <SendStateWords order={order} />
      </div>
      <ScheduledBanner order={order} />
      {order.metadata_json?.resend_reason && !order.sent_at ? <MessageBar tone="info">{order.metadata_json.resend_reason}. Revision {order.current_revision_no} has to go to the vendor again.</MessageBar> : null}
      <QuantityLotStrip ordered={quantityByUnit("ordered")} received={quantityByUnit("received")} open={quantityByUnit("open")}
        lots={order.lines.reduce((sum, line) => sum + Number(line.received_unit_count || 0), 0)}
        expectedLots={expectedLots} label="Ordered" />
      <WorkPanel title="Delivery dates" description={order.status === "RECEIVED" ? "Every delivery on this PO is received." : order.sent_at ? `Sent on ${CHANNEL_LABEL[order.sent_channel || ""] || "—"} by ${personName(order.sent_by)} on ${istDateTime(order.sent_at)}. Record the dates the vendor confirms; GRN fills the oldest date first.` : "Each dated arrival on this PO. The vendor confirms them after the PO is sent; GRN fills the oldest date first."}>
        <DeliveryDates order={order} canConfirm={canSend} onNotice={(tone, text) => { setNotice({ tone, text }); refresh() }} />
      </WorkPanel>
      <WorkPanel title="Saved purchase document" description="This is what the vendor sees and what prints." action={<StateBadge value={order.status} />}>
        <section className="po-print rounded-xl border border-border p-5">
          <div className="flex flex-wrap justify-between gap-4 border-b border-border pb-5"><div><p className="text-[12px] font-semibold text-signal-cyan-ink">Amigo Industries Unit-2</p><h2 className="mt-2 text-2xl font-semibold text-foreground">Purchase Order</h2></div><div className="text-right text-sm"><p className="font-semibold text-foreground">{order.po_no}</p><p className="mt-1 text-muted-foreground">Date {indianDate(order.po_date) || "-"} · Revision {order.current_revision_no}</p></div></div>
          <div className="grid gap-4 border-b border-border py-4 text-sm md:grid-cols-2"><div data-testid="po-supplier-block"><p className="text-[12px] font-semibold text-muted-foreground">Supplier</p><p className="mt-1 font-semibold text-foreground">{order.supplier_name}</p>{saved.supplier_legal_name && saved.supplier_legal_name !== order.supplier_name ? <p className="text-xs text-muted-foreground">{saved.supplier_legal_name}</p> : null}<p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">{saved.supplier_address || "Address as per vendor master"}</p><dl className="mt-2 grid max-w-xl grid-cols-[64px_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-xs">{supplierFacts.map(([label, value]) => <div key={label} className="contents"><dt className="text-muted-foreground">{label}</dt><dd className={label === "GSTIN" || label === "PAN" ? "font-mono font-semibold text-foreground" : "text-foreground"}>{value}</dd></div>)}</dl>{masterGstMissing ? <p className="no-print mt-2 text-xs text-signal-amber-ink">This revision was saved without a GSTIN. The vendor master now has {masterVendor.gst_no}: make a new revision (Edit / vendor change) to print it.</p> : null}</div><div className="md:text-right"><p className="text-[12px] font-semibold text-muted-foreground">Delivery</p><p className="mt-1 font-semibold text-foreground">Expected {indianDate(order.expected_date as any) || "As agreed"}</p><p className="mt-1 text-xs text-muted-foreground">Status {stateWord(order.status)} · Category {order.category.replaceAll("_", "/")}</p></div></div>
          {/* Phone: one card per line, so no column is cut off (checker 2026-10-30). The table stays for print and wider screens. */}
          <ul className="divide-y divide-border text-sm sm:hidden print:hidden" data-testid="po-doc-lines-phone">{order.lines.map((line, index) => <li key={line.id} className="py-3"><p className="font-semibold text-foreground"><span className="mr-1.5 text-muted-foreground">{index + 1}.</span>{line.item_code} · {line.description || line.item_name}</p><dl className="mt-1.5 grid grid-cols-3 gap-2 text-[12.5px]"><div className="min-w-0"><dt className="text-[11.5px] text-muted-foreground">Ordered</dt><dd className="break-words font-medium tabular-nums text-foreground">{qtyText(line.qty_ordered, line.uom)}</dd></div><div className="min-w-0"><dt className="text-[11.5px] text-muted-foreground">Rate</dt><dd className="break-words font-medium tabular-nums text-foreground">{line.unit_cost > 0 ? rateText(line.unit_cost, line.uom) : <span className="font-semibold text-signal-amber-ink">Rate needed</span>}</dd></div><div className="min-w-0 text-right"><dt className="text-[11.5px] text-muted-foreground">Amount</dt><dd className="break-words font-semibold tabular-nums text-foreground">{line.unit_cost > 0 ? `₹${(line.qty_ordered * line.unit_cost).toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : <span className="text-muted-foreground" title="Amount follows once the rate is set">—</span>}</dd></div></dl></li>)}<li className="flex items-baseline justify-between gap-3 py-3"><span className="font-semibold text-foreground">Total</span><span className="text-right text-lg font-semibold tabular-nums text-foreground">{missingRates && !pricedLines ? <span className="text-signal-amber-ink">Rate needed</span> : <>₹{total.toLocaleString("en-IN", { maximumFractionDigits: 2 })}{missingRates ? <span className="block text-[12px] font-medium text-signal-amber-ink">plus {missingRates} {missingRates === 1 ? "line" : "lines"} with rate needed</span> : null}</>}</span></li></ul>
          <div className="hidden overflow-x-auto sm:block print:block"><table className="w-full min-w-[680px] text-sm"><thead><tr className="border-b border-border text-left text-[11.5px] font-semibold text-muted-foreground">{['#','Material','Ordered quantity','Rate / unit','Amount'].map((head) => <th className="px-2 py-3" key={head}>{head}</th>)}</tr></thead><tbody>{order.lines.map((line, index) => <tr className="border-b border-border" key={line.id}><td className="px-2 py-3">{index + 1}</td><td className="px-2 py-3"><p className="font-semibold">{line.item_code} · {line.description || line.item_name}</p></td><td className="px-2 py-3 tabular-nums">{qtyText(line.qty_ordered, line.uom)}</td><td className="px-2 py-3 tabular-nums">{line.unit_cost > 0 ? rateText(line.unit_cost, line.uom) : <span className="font-semibold text-signal-amber-ink">Rate needed</span>}</td><td className="px-2 py-3 font-semibold tabular-nums">{line.unit_cost > 0 ? `₹${(line.qty_ordered * line.unit_cost).toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : <span className="text-muted-foreground" title="Amount follows once the rate is set">—</span>}</td></tr>)}</tbody><tfoot><tr><td colSpan={4} className="px-2 py-4 text-right font-semibold">Total</td><td className="px-2 py-4 text-lg font-semibold tabular-nums">{missingRates && !pricedLines ? <span className="text-signal-amber-ink">Rate needed</span> : <>₹{total.toLocaleString("en-IN", { maximumFractionDigits: 2 })}{missingRates ? <span className="block text-[12px] font-medium text-signal-amber-ink">plus {missingRates} {missingRates === 1 ? "line" : "lines"} with rate needed</span> : null}</>}</td></tr></tfoot></table></div>
          {deliveryRows(order).length ? <div className="mt-4 border-t border-border pt-3 text-xs"><p className="font-semibold text-foreground">Delivery dates</p><ul className="mt-1 grid gap-0.5 text-muted-foreground sm:grid-cols-2">{deliveryRows(order).map((row) => <li key={row.id}>{longDate(row.date)} · {row.item_name || row.item_code} · {qtyText(row.qty, row.uom)}{row.confirmation === "CONFIRMED" ? " · confirmed" : ""}</li>)}</ul></div> : null}
          <div className="mt-5 grid gap-2 border-t border-border pt-4 text-xs leading-5 text-muted-foreground"><p><strong>Payment:</strong> {(order as any).payment_terms || "As agreed"}</p><p><strong>Freight:</strong> {(order as any).freight_terms || "As agreed"}</p><p><strong>Tax:</strong> {(order as any).tax_terms || "As applicable"}</p><p><strong>Delivery:</strong> {deliveryTerms((order as any).delivery_terms)}</p><p><strong>Test report:</strong> {(order as any).test_report_terms || "Attach with delivery"}</p><p><strong>Special instruction:</strong> {(order as any).special_instruction || "—"}</p></div>
          <div className="mt-10 grid grid-cols-2 gap-10 pt-8 text-xs text-muted-foreground"><div className="border-t border-input pt-2">Prepared / checked by<p className="mt-1 text-[13px] font-medium text-foreground" data-testid="po-prepared-by">{preparedBy || (history.isLoading ? "…" : "—")}</p></div><div className="border-t border-input pt-2 text-right">For Amigo Industries Unit-2<p className="mt-1 text-[12px]">{history.isLoading ? "…" : approvedBy}</p></div></div>
        </section>
      </WorkPanel>



      <section className="grid gap-4 xl:grid-cols-[minmax(0,0.6fr)_minmax(0,1.4fr)]">
        <WorkPanel title="Approval" description="Who has approved this PO, and what is next.">
          <StateBadge value={order.status} />
          {order.status === "DRAFT" && order.send_check?.mode === "SEND_ON_SCHEDULE" ? <div className="mt-4 space-y-2" data-testid="po-approval-status"><p className="flex items-start gap-2 text-sm font-semibold text-signal-emerald-ink"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />Unchanged since the Owner approved</p><p className="text-sm text-muted-foreground">Send to vendor needs no second approval.</p><WhyNote>The Owner approved these arrivals on the RM inward calendar. If the desk changes a quantity, date, vendor or rate, the Owner approves the PO again. A change the Owner makes himself counts as his approval.</WhyNote></div> : ownerApprovesDraft ? <div className="mt-4 space-y-3"><p className="text-sm leading-6 text-muted-foreground">These arrivals were your decision; check what changed above, then approve. The desk sends it to the vendor.</p><Field label="Note" hint="optional"><input className={cn(fieldClass, "max-sm:h-11")} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What was checked" /></Field><button className={primaryButton} disabled={approve.isPending} onClick={() => approve.mutate()}><CheckCircle2 className="h-4 w-4" /> Approve PO</button></div> : order.status === "DRAFT" ? <div className="mt-4 space-y-3">{otherReasons.length ? <p className="text-sm leading-6 text-signal-amber-ink">{otherReasons.join(" ")}</p> : null}{changes.length && order.source !== "SCHEDULE" ? <p className="text-sm leading-6 text-signal-amber-ink">{changes.join(" ")}</p> : null}{canRevise ? <><Field label="Note for the Owner" hint="optional"><input className={cn(fieldClass, "max-sm:h-11")} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ready for commercial check" /></Field><p className="text-[12.5px] leading-5 text-muted-foreground">{rateNeeded.length ? <>Use <strong className="text-foreground">Fill the rate</strong> at the top for {rateNames(order).join(", ")}.{isOwner && order.source === "SCHEDULE" ? " A rate you fill yourself counts as your approval." : " Submit opens once every line has a rate."}</> : <>Then use <strong className="text-foreground">Submit for approval</strong> at the top of the page.</>}</p></> : null}</div> : order.status === "SUBMITTED" && canDecide ? <div className="mt-4 space-y-3"><Field label="Decision reason"><input className={cn(fieldClass, "max-sm:h-11")} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What was checked, or why it is sent back" /></Field><div className="flex flex-wrap gap-2"><button className={primaryButton} disabled={approve.isPending} onClick={() => approve.mutate()}><CheckCircle2 className="h-4 w-4" /> Approve</button><button className={secondaryButton} disabled={reject.isPending || reason.trim().length < 3} onClick={() => reject.mutate()}><XCircle className="h-4 w-4" /> Reject with reason</button></div></div> : order.status === "SUBMITTED" ? <p className="mt-4 text-sm leading-6 text-muted-foreground">{isOwner ? "You prepared or submitted this revision of a hand-made PO, so another Owner approves it (maker and checker are two people)." : "Submitted. The Owner approves it from the top of this page or from PO approvals; the submitter cannot approve their own revision."}</p> : <div className="mt-4 space-y-2"><p className="text-sm font-semibold text-foreground">{order.approval_source === "SCHEDULE" ? `Approved by ${personName(order.approved_by)} on the RM inward calendar` : order.approved_by ? `Approved by ${personName(order.approved_by)}` : stateWord(order.status)}</p><WhyNote title="What happens next">PO, then Owner approval, then send to the vendor. The vendor confirms the dates, goods come in on a GRN, and incoming QC checks every delivery.</WhyNote></div>}
          {['APPROVED','PARTIALLY_RECEIVED'].includes(order.status) && canClose ? <div className="mt-5 space-y-3 border-t border-border pt-4"><Field label="Close reason"><input className={cn(fieldClass, "max-sm:h-11")} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why the open quantities will not arrive" /></Field><button className={secondaryButton} disabled={reason.trim().length < 3 || shortClose.isPending} onClick={() => shortClose.mutate()}><Ban className="h-4 w-4" /> Short-close remaining quantities</button></div> : null}
          {['DRAFT','SUBMITTED','REJECTED','APPROVED'].includes(order.status) && canClose && order.lines.every((line) => line.qty_received === 0) ? <div className="mt-3"><button className={secondaryButton} disabled={reason.trim().length < 3 || cancel.isPending} onClick={() => cancel.mutate()}><Ban className="h-4 w-4" /> Cancel unreceived PO</button></div> : null}
        </WorkPanel>
        <WorkPanel title="Revision history" description="Every version of this PO: why it changed, who made it and who approved it.">
          <div className="space-y-2">{(history.data?.data?.items || []).map((revision: any) => <div key={revision.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted px-4 py-3"><div className="flex min-w-0 items-start gap-3"><Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-signal-cyan-ink" /><div className="min-w-0"><p className="text-sm font-semibold text-foreground">Revision {revision.revision_no} · {revision.change_reason || "Original issue"}</p><p className="mt-1 break-words text-xs text-muted-foreground">Made by {personName(revision.created_by)}{revision.created_at ? ` on ${istDateTime(revision.created_at)}` : ""} · {revision.approved_by ? `approved by ${personName(revision.approved_by)}${revision.approved_at ? ` on ${istDateTime(revision.approved_at)}` : ""}` : revision.approval_state === "SUBMITTED" ? "waiting for the Owner" : "not approved"}</p></div></div><StateBadge value={revision.approval_state} /></div>)}{history.isLoading ? <div className="h-20 animate-pulse rounded-lg bg-muted" /> : null}</div>
        </WorkPanel>
      </section>
      {canSend ? <SendSheet open={sendOpen} onOpenChange={setSendOpen} order={order} vendor={masterVendor}
        onSent={(sent, channel) => { setNotice({ tone: "success", text: `${sent.po_no} ${sent.approval_source === "SCHEDULE" && order.status === "DRAFT" ? "approved on the Owner's schedule approval and " : ""}marked sent on ${CHANNEL_LABEL[channel]}.` }); refresh() }} /> : null}
    </ProcurementShell>
  )
}
