"use client"

import Link from "next/link"
import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CalendarRange, CheckCircle2, Clock3, IndianRupee, ShieldCheck, XCircle } from "lucide-react"

import { longDate, perUnit, qty as qtyText, rateText, rupees } from "@/components/procurement/rm-calendar/format"
import { useApproveArrivals, useProposedArrivals } from "@/hooks/use-rm-calendar"
import { apiErrorText } from "@/lib/api-rm-calendar"

import { EmptyState } from "@/components/erp/shell"
import { RequestErrors, Field, MessageBar, ProcurementShell, StateBadge, SummaryCard, WorkPanel, fieldClass, primaryButton, secondaryButton } from "@/components/procurement/procurement-shell"
import { RoleGate } from "@/components/workspace/role-gate"
import { useAuth } from "@/context/AuthContext"
import { api, purchaseApi } from "@/lib/api"
import type { PurchaseOrder } from "@/lib/procurement-types"

export default function PurchaseApprovalsPage() {
  const { activePlant, user } = useAuth(); const client = useQueryClient()
  // The Owner and an Admin decide POs, also one they made themselves (user decision 2026-10-30). RM arrivals
  // and requisitions stay the Owner's decision.
  const roles = new Set([user?.role, ...(user?.roles || [])].filter(Boolean) as string[])
  const isOwner = roles.has("Owner")
  const decider: "Owner" | "Admin" | null = isOwner ? "Owner" : roles.has("Admin") ? "Admin" : null
  const mine = (order: PurchaseOrder) => Boolean(user?.email) && ((order as any).revision_makers || []).some((maker: string) => maker.trim().toLowerCase() === String(user?.email || "").trim().toLowerCase())
  const [reason, setReason] = useState<Record<string, string>>({}); const [notice, setNotice] = useState("")
  const query = useQuery({ queryKey: ["purchase-v2", "orders", activePlant], enabled: Boolean(activePlant && activePlant !== "ALL"), queryFn: () => purchaseApi.getOrders({ status: "SUBMITTED", limit: 200 }) })
  const orders: PurchaseOrder[] = (query.data?.data?.items || []).filter((row: PurchaseOrder) => row.status === "SUBMITTED")
  const invalidate = () => client.invalidateQueries({ queryKey: ["purchase-v2"] })
  const approve = useMutation({ mutationFn: (order: PurchaseOrder) => purchaseApi.approveOrder(order.id, { expected_version: order.version, reason: reason[order.id] || "Commercial terms verified" }), onSuccess: () => { setNotice("Purchase order revision approved. Stores can now receive against its approved balance."); invalidate() } })
  const reject = useMutation({ mutationFn: (order: PurchaseOrder) => purchaseApi.rejectOrder(order.id, { expected_version: order.version, reason: reason[order.id] }), onSuccess: () => { setNotice("Revision returned with its reason preserved in history."); invalidate() } })
  const value = orders.reduce((sum, order) => sum + order.lines.reduce((lineSum, line) => lineSum + line.qty_ordered * line.unit_cost, 0), 0)
  const requisitions = useQuery({ queryKey: ["purchase-requisitions", activePlant, "SUBMITTED"], enabled: isOwner && Boolean(activePlant && activePlant !== "ALL"), queryFn: () => api.get("/api/purchase/requisitions", { params: { status: "SUBMITTED" } }) })
  const pendingRequisitions: any[] = requisitions.data?.data?.items || []
  const proposed = useProposedArrivals()
  const proposedRows = proposed.data || []
  const approveArrivals = useApproveArrivals()
  const proposedUnits = proposedRows.reduce((totals, row) => ({ ...totals, [row.item?.uom || ""]: (totals[row.item?.uom || ""] || 0) + row.qty }), {} as Record<string, number>)
  const decideRequisition = useMutation({ mutationFn: ({ row, decision }: { row: any; decision: string }) => api.post(`/api/purchase/requisitions/${row.id}/decision`, { decision, expected_version: row.version, reason: reason[row.id] }), onSuccess: () => { setNotice("Requisition decision saved."); client.invalidateQueries({ queryKey: ["purchase-requisitions"] }) } })

  return <RoleGate allow={["Owner", "Admin"]} omitOwnerAdmin>
    <ProcurementShell eyebrow="Owner and Admin approval" title="PO approvals"
      description="Content and version checks prevent stale decisions. The Owner or an Admin approves; they may approve a PO they made themselves, and the history records it.">
      <RequestErrors errors={[approve.error, reject.error, query.error, requisitions.error, decideRequisition.error]} />
    {notice ? <MessageBar tone="success">{notice}</MessageBar> : null}
      <section className="grid gap-3 sm:grid-cols-3"><SummaryCard label="Waiting" value={orders.length} detail="Submitted revisions" icon={Clock3} tone="amber" /><SummaryCard label="Value to review" value={`₹${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`} detail="Current submitted amount" icon={IndianRupee} tone="cyan" /><SummaryCard label="Who approves" value="Owner or Admin" detail="The desk makes and submits a PO; the Owner or an Admin approves it, also one they made themselves (recorded in the history)" icon={ShieldCheck} tone="emerald" /></section>
      {isOwner ? <>
      <WorkPanel title="RM arrivals to approve" description="Arrivals the desk proposed on the RM inward calendar. Approving puts them on draft POs, one per vendor per week, ready for the desk to send."
        action={<Link href="/purchase/scheduler?review=1" className={secondaryButton}><CalendarRange className="h-4 w-4" aria-hidden="true" />Review on the calendar</Link>}>
        {proposed.isLoading ? <div className="h-16 animate-pulse rounded-lg bg-muted" /> : proposedRows.length ? (
          <div className="space-y-3">
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
              {proposedRows.slice(0, 8).map((row) => <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm"><span className="min-w-0"><span className="font-semibold text-foreground">{row.item?.item_name || row.item?.item_code || "Material"}</span>{row.item?.item_code ? <span className="text-muted-foreground"> ({row.item.item_code})</span> : null} <span className="text-muted-foreground">· {longDate(row.date)}{row.late_proposal ? <span className="font-semibold text-signal-rose-ink"> (late, goes on today)</span> : null} · {row.supplier_name || <span className="font-semibold text-signal-amber-ink">no vendor yet</span>}{row.supplier_id ? ` · ${rateText(row.rate, row.item?.uom)}` : ""}</span></span><span className="text-right"><span className="block font-semibold tabular-nums">{qtyText(row.qty, row.item?.uom)}</span>{row.rate ? <span className="block text-xs text-muted-foreground">Value {rupees(row.rate * row.qty)}</span> : null}</span></li>)}
              {proposedRows.length > 8 ? <li className="px-4 py-2.5 text-sm text-muted-foreground">…and {proposedRows.length - 8} more on the calendar</li> : null}
            </ul>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">{proposedRows.length} arrival{proposedRows.length === 1 ? "" : "s"} · {perUnit(proposedUnits)}{proposedRows.some((row) => !row.supplier_id) ? <span className="font-semibold text-signal-amber-ink"> · {proposedRows.filter((row) => !row.supplier_id).length} need a vendor (pick it in Review on the calendar)</span> : null}</p>
              <button className={primaryButton} disabled={approveArrivals.isPending || !proposedRows.some((row) => row.supplier_id)} onClick={() => approveArrivals.mutate({ entryIds: proposedRows.filter((row) => row.supplier_id).map((row) => row.entry_id!), supplierIds: Array.from(new Set(proposedRows.map((row) => row.supplier_id).filter(Boolean) as string[])) },
                { onSuccess: (result) => setNotice(`${result.approved.length} arrival(s) approved. ${result.purchase_orders.length} draft PO(s) ready to send: ${result.purchase_orders.map((row) => row.po_no).join(", ")}.${result.skipped.length ? ` Not approved: ${result.skipped.map((row) => row.reason).join("; ")}.` : ""}`) })}>
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />{approveArrivals.isPending ? "Approving…" : "Approve all with a vendor"}
              </button>
            </div>
            {approveArrivals.isError ? <MessageBar tone="error">{apiErrorText(approveArrivals.error)}</MessageBar> : null}
          </div>
        ) : <p className="text-sm text-muted-foreground">No RM arrival is waiting. Proposed arrivals appear here and on the RM inward calendar.</p>}
      </WorkPanel>
      <WorkPanel title="Requisitions waiting for your decision" description="Step 1 of purchasing: an approved requisition becomes a PO. Tools, spares and other materials need this before a PO.">
        {requisitions.isLoading ? <div className="h-16 animate-pulse rounded-lg bg-muted" /> : pendingRequisitions.length ? <div className="space-y-3">{pendingRequisitions.map((row) => <article key={row.id} className="rounded-xl border border-border p-4">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-semibold text-foreground">{row.pr_no} · {row.item_name}</p><p className="mt-1 text-sm text-muted-foreground">{row.quantity} {row.uom} · {row.pr_date} · requested by {row.requested_by}</p><p className="mt-1 text-sm">{row.reason}</p></div><StateBadge value={row.status} /></div>
          <div className="mt-3 grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]"><input aria-label={`Decision reason for ${row.pr_no}`} className={fieldClass} placeholder="Approval or rejection reason" value={reason[row.id] || ""} onChange={(e) => setReason({ ...reason, [row.id]: e.target.value })} /><div className="flex gap-2"><button className={primaryButton} disabled={decideRequisition.isPending || (reason[row.id] || "").trim().length < 3} onClick={() => decideRequisition.mutate({ row, decision: "APPROVED" })}><CheckCircle2 className="h-4 w-4" /> Approve</button><button className={secondaryButton} disabled={decideRequisition.isPending || (reason[row.id] || "").trim().length < 3} onClick={() => decideRequisition.mutate({ row, decision: "REJECTED" })}><XCircle className="h-4 w-4" /> Reject</button></div></div>
        </article>)}</div> : <p className="text-sm text-muted-foreground">No requisitions are waiting. New requests appear here and in your inbox.</p>}
      </WorkPanel>
      </> : null}
      <WorkPanel title="Purchase order approval inbox" description="Step 3 of purchasing. Open the full saved PO before deciding. A rejection reason is mandatory.">
        {query.isLoading ? <div className="h-40 animate-pulse rounded-lg bg-muted" /> : orders.length ? <div className="space-y-3">{orders.map((order) => <article key={order.id} className="rounded-xl border border-border p-4">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)_auto] xl:items-end">
            <div><div className="flex flex-wrap items-center gap-2"><Link href={`/purchase/${order.id}`} className="text-lg font-semibold text-signal-cyan-ink hover:underline">{order.po_no} · Revision {order.current_revision_no}</Link><StateBadge value={order.status} /></div><p className="mt-2 text-sm font-medium text-muted-foreground">{order.supplier_name}</p><p className="mt-1 text-xs text-muted-foreground">{order.lines.map((line) => line.item_name || line.item_code).join(", ")} · {perUnit(order.lines.reduce((totals, line) => ({ ...totals, [line.uom]: (totals[line.uom] || 0) + line.qty_ordered }), {} as Record<string, number>))} · Value ₹{order.lines.reduce((sum, line) => sum + line.qty_ordered * line.unit_cost, 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}</p></div>
            <Field label="Decision reason"><input className={fieldClass} value={reason[order.id] || ""} onChange={(e) => setReason({ ...reason, [order.id]: e.target.value })} placeholder="What was checked or why rejected" /></Field>
            {decider ? <div className="space-y-1.5"><div className="flex gap-2"><button className={primaryButton} disabled={approve.isPending} onClick={() => approve.mutate(order)}><CheckCircle2 className="h-4 w-4" /> Approve</button><button className={secondaryButton} disabled={(reason[order.id] || "").trim().length < 3 || reject.isPending} onClick={() => reject.mutate(order)}><XCircle className="h-4 w-4" /> Reject</button></div>{mine(order) ? <p className="max-w-xs text-[12px] leading-5 text-muted-foreground" data-testid="po-approvals-self-note">Your own revision: as {decider} you may approve it; the history records it as approved by the same person.</p> : null}</div>
              : null}
          </div>
        </article>)}</div> : <EmptyState label="No submitted purchase order revisions need approval." />}
      </WorkPanel>
    </ProcurementShell>
  </RoleGate>
}
