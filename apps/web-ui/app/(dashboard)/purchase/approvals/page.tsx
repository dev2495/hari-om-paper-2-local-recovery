"use client"

import Link from "next/link"
import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CheckCircle2, Clock3, IndianRupee, ShieldCheck, XCircle } from "lucide-react"

import { EmptyState } from "@/components/erp/shell"
import { RequestErrors, Field, MessageBar, ProcurementShell, StateBadge, SummaryCard, WorkPanel, fieldClass, primaryButton, secondaryButton } from "@/components/procurement/procurement-shell"
import { RoleGate } from "@/components/workspace/role-gate"
import { useAuth } from "@/context/AuthContext"
import { api, purchaseApi } from "@/lib/api"
import type { PurchaseOrder } from "@/lib/procurement-types"

export default function PurchaseApprovalsPage() {
  const { activePlant } = useAuth(); const client = useQueryClient()
  const [reason, setReason] = useState<Record<string, string>>({}); const [notice, setNotice] = useState("")
  const query = useQuery({ queryKey: ["purchase-v2", "orders", activePlant], enabled: Boolean(activePlant && activePlant !== "ALL"), queryFn: () => purchaseApi.getOrders({ status: "SUBMITTED", limit: 200 }) })
  const orders: PurchaseOrder[] = (query.data?.data?.items || []).filter((row: PurchaseOrder) => row.status === "SUBMITTED")
  const invalidate = () => client.invalidateQueries({ queryKey: ["purchase-v2"] })
  const approve = useMutation({ mutationFn: (order: PurchaseOrder) => purchaseApi.approveOrder(order.id, { expected_version: order.version, reason: reason[order.id] || "Commercial terms verified" }), onSuccess: () => { setNotice("Purchase order revision approved. Stores can now receive against its approved balance."); invalidate() } })
  const reject = useMutation({ mutationFn: (order: PurchaseOrder) => purchaseApi.rejectOrder(order.id, { expected_version: order.version, reason: reason[order.id] }), onSuccess: () => { setNotice("Revision returned with its reason preserved in history."); invalidate() } })
  const value = orders.reduce((sum, order) => sum + order.lines.reduce((lineSum, line) => lineSum + line.qty_ordered * line.unit_cost, 0), 0)
  const requisitions = useQuery({ queryKey: ["purchase-requisitions", activePlant, "SUBMITTED"], enabled: Boolean(activePlant && activePlant !== "ALL"), queryFn: () => api.get("/api/purchase/requisitions", { params: { status: "SUBMITTED" } }) })
  const pendingRequisitions: any[] = requisitions.data?.data?.items || []
  const decideRequisition = useMutation({ mutationFn: ({ row, decision }: { row: any; decision: string }) => api.post(`/api/purchase/requisitions/${row.id}/decision`, { decision, expected_version: row.version, reason: reason[row.id] }), onSuccess: () => { setNotice("Requisition decision saved."); client.invalidateQueries({ queryKey: ["purchase-requisitions"] }) } })

  return <RoleGate allow={["Owner"]} omitOwnerAdmin>
    <ProcurementShell eyebrow="Owner approval" title="PO approvals"
      description="Content and version checks prevent stale decisions. The revision maker or submitter cannot approve it by switching roles.">
      <RequestErrors errors={[approve.error, reject.error, query.error, requisitions.error, decideRequisition.error]} />
    {notice ? <MessageBar tone="success">{notice}</MessageBar> : null}
      <section className="grid gap-3 sm:grid-cols-3"><SummaryCard label="Waiting" value={orders.length} detail="Submitted revisions" icon={Clock3} tone="amber" /><SummaryCard label="Value to review" value={`₹${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`} detail="Current submitted amount" icon={IndianRupee} tone="cyan" /><SummaryCard label="Control" value="Maker ≠ checker" detail="Actual identity enforced by API" icon={ShieldCheck} tone="emerald" /></section>
      <WorkPanel title="Requisitions waiting for your decision" description="Step 1 of purchasing: an approved requisition becomes a PO. Tools, spares and other materials need this before a PO.">
        {requisitions.isLoading ? <div className="h-16 animate-pulse rounded-lg bg-muted" /> : pendingRequisitions.length ? <div className="space-y-3">{pendingRequisitions.map((row) => <article key={row.id} className="rounded-xl border border-border p-4">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-semibold text-foreground">{row.pr_no} · {row.item_name}</p><p className="mt-1 text-sm text-muted-foreground">{row.quantity} {row.uom} · {row.pr_date} · requested by {row.requested_by}</p><p className="mt-1 text-sm">{row.reason}</p></div><StateBadge value={row.status} /></div>
          <div className="mt-3 grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]"><input aria-label={`Decision reason for ${row.pr_no}`} className={fieldClass} placeholder="Approval or rejection reason" value={reason[row.id] || ""} onChange={(e) => setReason({ ...reason, [row.id]: e.target.value })} /><div className="flex gap-2"><button className={primaryButton} disabled={decideRequisition.isPending || (reason[row.id] || "").trim().length < 3} onClick={() => decideRequisition.mutate({ row, decision: "APPROVED" })}><CheckCircle2 className="h-4 w-4" /> Approve</button><button className={secondaryButton} disabled={decideRequisition.isPending || (reason[row.id] || "").trim().length < 3} onClick={() => decideRequisition.mutate({ row, decision: "REJECTED" })}><XCircle className="h-4 w-4" /> Reject</button></div></div>
        </article>)}</div> : <p className="text-sm text-muted-foreground">No requisitions are waiting. New requests appear here and in your inbox.</p>}
      </WorkPanel>
      <WorkPanel title="Purchase order approval inbox" description="Step 3 of purchasing. Open the full saved PO before deciding. A rejection reason is mandatory.">
        {query.isLoading ? <div className="h-40 animate-pulse rounded-lg bg-muted" /> : orders.length ? <div className="space-y-3">{orders.map((order) => <article key={order.id} className="rounded-xl border border-border p-4">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)_auto] xl:items-end">
            <div><div className="flex flex-wrap items-center gap-2"><Link href={`/purchase/${order.id}`} className="text-lg font-semibold text-signal-cyan-ink hover:underline">{order.po_no} · Revision {order.current_revision_no}</Link><StateBadge value={order.status} /></div><p className="mt-2 text-sm font-medium text-muted-foreground">{order.supplier_name}</p><p className="mt-1 text-xs text-muted-foreground">{order.lines.length} lines · {Object.entries(order.lines.reduce((totals, line) => ({ ...totals, [line.uom]: (totals[line.uom] || 0) + line.qty_ordered }), {} as Record<string, number>)).map(([unit, qty]) => `${qty.toLocaleString("en-IN")} ${unit}`).join(" + ")} · ₹{order.lines.reduce((sum, line) => sum + line.qty_ordered * line.unit_cost, 0).toLocaleString("en-IN")}</p></div>
            <Field label="Decision reason"><input className={fieldClass} value={reason[order.id] || ""} onChange={(e) => setReason({ ...reason, [order.id]: e.target.value })} placeholder="What was checked or why rejected" /></Field>
            <div className="flex gap-2"><button className={primaryButton} disabled={approve.isPending} onClick={() => approve.mutate(order)}><CheckCircle2 className="h-4 w-4" /> Approve</button><button className={secondaryButton} disabled={(reason[order.id] || "").trim().length < 3 || reject.isPending} onClick={() => reject.mutate(order)}><XCircle className="h-4 w-4" /> Reject</button></div>
          </div>
        </article>)}</div> : <EmptyState label="No submitted purchase order revisions need approval." />}
      </WorkPanel>
    </ProcurementShell>
  </RoleGate>
}
