"use client"

import Link from "next/link"
import { useState } from "react"
import { useParams } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Ban, Clock3, PencilLine, Printer, Send } from "lucide-react"

import { EmptyState } from "@/components/erp/shell"
import { Field, MessageBar, ProcurementShell, QuantityLotStrip, StateBadge, WorkPanel, fieldClass, primaryButton, secondaryButton } from "@/components/procurement/procurement-shell"
import { useAuth } from "@/context/AuthContext"
import { purchaseApi } from "@/lib/api"
import type { PurchaseOrder } from "@/lib/procurement-types"

export default function PurchaseOrderDetailPage() {
  const params = useParams<{ id: string }>()
  const { activePlant } = useAuth()
  const queryClient = useQueryClient()
  const [reason, setReason] = useState("")
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null)
  const orderQuery = useQuery({ queryKey: ["purchase-v2", "order", activePlant, params.id], queryFn: () => purchaseApi.getOrder(params.id), enabled: Boolean(activePlant && activePlant !== "ALL") && Boolean(params.id) })
  const order = orderQuery.data?.data as PurchaseOrder | undefined
  const history = useQuery({ queryKey: ["purchase-v2", "history", params.id, activePlant], queryFn: () => purchaseApi.getOrderHistory(params.id), enabled: Boolean(activePlant && activePlant !== "ALL") && Boolean(order) })

  const refresh = () => { queryClient.invalidateQueries({ queryKey: ["purchase-v2"] }); queryClient.invalidateQueries({ queryKey: ["purchase"] }) }
  const submit = useMutation({ mutationFn: () => purchaseApi.submitOrder(params.id, { expected_version: order?.version, reason: reason || "Ready for commercial approval" }), onSuccess: () => { setNotice({ tone: "success", text: "Revision submitted for independent approval." }); refresh() }, onError: (error: any) => setNotice({ tone: "error", text: error?.response?.data?.detail || error.message }) })
  const shortClose = useMutation({ mutationFn: () => purchaseApi.shortCloseOrder(order!.id, { expected_version: order!.version, reason, lines: [] }), onSuccess: () => { setNotice({ tone: "success", text: "All remaining quantities were short-closed with the saved reason." }); setReason(""); refresh() }, onError: (error: any) => setNotice({ tone: "error", text: error?.response?.data?.detail || error.message }) })
  const cancel = useMutation({ mutationFn: () => purchaseApi.cancelOrder(order!.id, { expected_version: order!.version, reason }), onSuccess: () => { setNotice({ tone: "success", text: "Unreceived purchase order cancelled with history preserved." }); setReason(""); refresh() }, onError: (error: any) => setNotice({ tone: "error", text: error?.response?.data?.detail || error.message }) })

  if (!activePlant || activePlant === "ALL") return <ProcurementShell eyebrow="Purchasing" title="Purchase order" description="Select the purchase order plant.">{null}</ProcurementShell>
  if (orderQuery.isLoading) return <div className="h-72 animate-pulse rounded-xl bg-muted" />
  if (!order) return <EmptyState label="Purchase order not found in this plant." />
  const total = order.lines.reduce((sum, line) => sum + line.qty_ordered * line.unit_cost, 0)
  const quantityByUnit = (basis: "ordered" | "received" | "open") => Object.entries(order.lines.reduce((totals, line) => {
    const quantity = basis === "ordered" ? line.qty_ordered : basis === "received" ? line.qty_received : Math.max(0, line.qty_ordered - line.qty_received - (line.qty_short_closed || 0))
    totals[line.uom] = (totals[line.uom] || 0) + quantity
    return totals
  }, {} as Record<string, number>)).map(([unit, qty]) => `${qty.toLocaleString("en-IN")} ${unit}`).join(" + ")
  const expectedLots = order.lines.some((line) => line.expected_unit_count !== null && line.expected_unit_count !== undefined)
    ? order.lines.reduce((sum, line) => sum + Number(line.expected_unit_count || 0), 0)
    : null

  return (
    <ProcurementShell eyebrow={`${order.po_no} · Revision ${order.current_revision_no}`} title={`${order.supplier_name} purchase order`}
      description="The printed document, approval decision, inward allocation and future revisions all refer to this saved commercial record."
      actions={<><a className={secondaryButton} href={purchaseApi.orderPdfUrl(order.id, order.current_revision_no)} target="_blank" rel="noreferrer"><Printer className="h-4 w-4" /> Saved PDF</a>{!['RECEIVED','CANCELLED','SHORT_CLOSED'].includes(order.status) ? <Link className={secondaryButton} href={`/purchase/${order.id}/edit`}><PencilLine className="h-4 w-4" /> Edit / vendor change</Link> : null}</>}>
      {notice ? <MessageBar tone={notice.tone}>{notice.text}</MessageBar> : null}
      <QuantityLotStrip ordered={quantityByUnit("ordered")} received={quantityByUnit("received")} open={quantityByUnit("open")}
        lots={order.lines.reduce((sum, line) => sum + Number(line.received_unit_count || 0), 0)}
        expectedLots={expectedLots} label="Ordered" />
      <WorkPanel title="Saved purchase document" description="This view prints as the supplier-facing PO. Internal controls stay outside the print section." action={<StateBadge value={order.status} />}>
        <section className="po-print rounded-xl border border-border p-5">
          <div className="flex flex-wrap justify-between gap-4 border-b border-border pb-5"><div><p className="text-[12px] font-semibold text-signal-cyan-ink">Amigo Industries Unit-2</p><h2 className="mt-2 text-2xl font-semibold text-foreground">Purchase Order</h2></div><div className="text-right text-sm"><p className="font-semibold text-foreground">{order.po_no}</p><p className="mt-1 text-muted-foreground">Date {order.po_date || "-"} · Revision {order.current_revision_no}</p></div></div>
          <div className="grid gap-4 border-b border-border py-4 text-sm md:grid-cols-2"><div><p className="text-[12px] font-semibold text-muted-foreground">Supplier</p><p className="mt-1 font-semibold text-foreground">{order.supplier_name}</p><p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">{(order as any).supplier_address || "Address as per vendor master"}{(order as any).supplier_contact ? ` · ${(order as any).supplier_contact}` : ""}{(order as any).supplier_gst_no ? ` · GST ${(order as any).supplier_gst_no}` : ""}</p></div><div className="md:text-right"><p className="text-[12px] font-semibold text-muted-foreground">Delivery</p><p className="mt-1 font-semibold text-foreground">Expected {order.expected_date || "As agreed"}</p><p className="mt-1 text-xs text-muted-foreground">Status {order.status.replaceAll("_", " ")} · Category {order.category.replaceAll("_", "/")}</p></div></div>
          <div className="overflow-x-auto"><table className="w-full min-w-[780px] text-sm"><thead><tr className="border-b border-border text-left text-[11.5px] font-semibold text-muted-foreground">{['#','Material / specification','Quantity','Expected units','Rate / unit','Amount'].map((head) => <th className="px-2 py-3" key={head}>{head}</th>)}</tr></thead><tbody>{order.lines.map((line, index) => <tr className="border-b border-border" key={line.id}><td className="px-2 py-3">{index + 1}</td><td className="px-2 py-3"><p className="font-semibold">{line.item_code} · {line.description || line.item_name}</p><p className="mt-1 text-xs text-muted-foreground">{[line.width_mm && `${line.width_mm} mm`, line.gsm && `${line.gsm} GSM`, line.plybond && `PB ${line.plybond}`, line.bulk && `Bulk ${line.bulk}`, line.cobb].filter(Boolean).join(" · ") || "Standard as approved"}</p></td><td className="px-2 py-3 tabular-nums">{line.qty_ordered.toLocaleString("en-IN")} {line.uom}</td><td className="px-2 py-3 tabular-nums">{line.expected_unit_count ? `${line.expected_unit_count} ${line.count_basis?.toLowerCase()}` : "-"}</td><td className="px-2 py-3 tabular-nums">₹{line.unit_cost.toLocaleString("en-IN", { maximumFractionDigits: 4 })} / {line.uom}</td><td className="px-2 py-3 font-semibold tabular-nums">₹{(line.qty_ordered * line.unit_cost).toLocaleString("en-IN", { maximumFractionDigits: 2 })}</td></tr>)}</tbody><tfoot><tr><td colSpan={5} className="px-2 py-4 text-right font-semibold">Total</td><td className="px-2 py-4 text-lg font-semibold tabular-nums">₹{total.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</td></tr></tfoot></table></div>
          <div className="mt-5 grid gap-2 border-t border-border pt-4 text-xs leading-5 text-muted-foreground"><p><strong>Payment:</strong> {(order as any).payment_terms || "As agreed"}</p><p><strong>Freight:</strong> {(order as any).freight_terms || "As agreed"}</p><p><strong>Tax:</strong> {(order as any).tax_terms || "As applicable"}</p><p><strong>Delivery:</strong> {(order as any).delivery_terms || "As agreed"}</p><p><strong>Test report:</strong> {(order as any).test_report_terms || "Attach with delivery"}</p><p><strong>Special instruction:</strong> {(order as any).special_instruction || "—"}</p></div>
          <div className="mt-10 grid grid-cols-2 gap-10 pt-8 text-xs text-muted-foreground"><div className="border-t border-input pt-2">Prepared / checked by</div><div className="border-t border-input pt-2 text-right">For Amigo Industries Unit-2</div></div>
        </section>
      </WorkPanel>



      <section className="grid gap-4 xl:grid-cols-[minmax(0,0.6fr)_minmax(0,1.4fr)]">
        <WorkPanel title="Approval control" description="The submitting person cannot approve the same revision.">
          <StateBadge value={order.status} />
          {order.status === "DRAFT" ? <div className="mt-4 space-y-3"><Field label="Submission note"><input className={fieldClass} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ready for commercial check" /></Field><button className={primaryButton} disabled={submit.isPending} onClick={() => submit.mutate()}><Send className="h-4 w-4" /> Submit for approval</button></div> : <p className="mt-4 text-sm leading-6 text-muted-foreground">Use the Approval Inbox for approve/reject decisions and content-hash protection.</p>}
          {['APPROVED','PARTIALLY_RECEIVED'].includes(order.status) ? <div className="mt-5 space-y-3 border-t border-border pt-4"><Field label="Close reason"><input className={fieldClass} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why the open quantities will not arrive" /></Field><button className={secondaryButton} disabled={reason.trim().length < 3 || shortClose.isPending} onClick={() => shortClose.mutate()}><Ban className="h-4 w-4" /> Short-close remaining quantities</button></div> : null}
          {['DRAFT','SUBMITTED','REJECTED','APPROVED'].includes(order.status) && order.lines.every((line) => line.qty_received === 0) ? <div className="mt-3"><button className={secondaryButton} disabled={reason.trim().length < 3 || cancel.isPending} onClick={() => cancel.mutate()}><Ban className="h-4 w-4" /> Cancel unreceived PO</button></div> : null}
        </WorkPanel>
        <WorkPanel title="Revision history" description="Every version, content hash, maker and checker stays reviewable.">
          <div className="space-y-2">{(history.data?.data?.items || []).map((revision: any) => <div key={revision.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted px-4 py-3"><div className="flex items-start gap-3"><Clock3 className="mt-0.5 h-4 w-4 text-signal-cyan-ink" /><div><p className="text-sm font-semibold text-foreground">Revision {revision.revision_no} · {revision.change_reason || "Original issue"}</p><p className="mt-1 font-mono text-[10px] text-muted-foreground">{revision.content_hash}</p><p className="mt-1 text-xs text-muted-foreground">Created {revision.created_by} · Approved {revision.approved_by || "pending"}</p></div></div><StateBadge value={revision.approval_state} /></div>)}{history.isLoading ? <div className="h-20 animate-pulse rounded-lg bg-muted" /> : null}</div>
        </WorkPanel>
      </section>
    </ProcurementShell>
  )
}
