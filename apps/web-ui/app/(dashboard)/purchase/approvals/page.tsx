"use client"

import Link from "next/link"
import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CheckCircle2, Clock3, IndianRupee, ShieldCheck, XCircle } from "lucide-react"

import { EmptyState } from "@/components/erp/shell"
import { RequestErrors, Field, MessageBar, ProcurementShell, StateBadge, SummaryCard, WorkPanel, fieldClass, primaryButton, secondaryButton } from "@/components/procurement/procurement-shell"
import { RoleGate } from "@/components/workspace/role-gate"
import { useAuth } from "@/context/AuthContext"
import { purchaseApi } from "@/lib/api"
import type { PurchaseOrder } from "@/lib/procurement-types"

export default function PurchaseApprovalsPage() {
  const { activePlant } = useAuth(); const client = useQueryClient()
  const [reason, setReason] = useState<Record<string, string>>({}); const [notice, setNotice] = useState("")
  const query = useQuery({ queryKey: ["purchase-v2", "orders", activePlant], enabled: Boolean(activePlant && activePlant !== "ALL"), queryFn: () => purchaseApi.getOrders() })
  const orders: PurchaseOrder[] = (query.data?.data?.items || []).filter((row: PurchaseOrder) => row.status === "SUBMITTED")
  const invalidate = () => client.invalidateQueries({ queryKey: ["purchase-v2"] })
  const approve = useMutation({ mutationFn: (order: PurchaseOrder) => purchaseApi.approveOrder(order.id, { expected_version: order.version, reason: reason[order.id] || "Commercial terms verified" }), onSuccess: () => { setNotice("Purchase order revision approved. Stores can now receive against its kg balance."); invalidate() } })
  const reject = useMutation({ mutationFn: (order: PurchaseOrder) => purchaseApi.rejectOrder(order.id, { expected_version: order.version, reason: reason[order.id] }), onSuccess: () => { setNotice("Revision returned with its reason preserved in history."); invalidate() } })
  const value = orders.reduce((sum, order) => sum + order.lines.reduce((lineSum, line) => lineSum + line.qty_ordered * line.unit_cost, 0), 0)

  return <RoleGate allow={["PlantManager"]}>
    <ProcurementShell eyebrow="Independent checker" title="PO approvals"
      description="Content and version checks prevent stale decisions. The revision maker or submitter cannot approve it by switching roles.">
      <RequestErrors errors={[approve.error, reject.error, query.error]} />
    {notice ? <MessageBar tone="success">{notice}</MessageBar> : null}
      <section className="grid gap-3 sm:grid-cols-3"><SummaryCard label="Waiting" value={orders.length} detail="Submitted revisions" icon={Clock3} tone="amber" /><SummaryCard label="Value to review" value={`₹${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`} detail="Current submitted amount" icon={IndianRupee} tone="cyan" /><SummaryCard label="Control" value="Maker ≠ checker" detail="Actual identity enforced by API" icon={ShieldCheck} tone="emerald" /></section>
      <WorkPanel title="Approval inbox" description="Open the full saved PO before deciding. A rejection reason is mandatory.">
        {query.isLoading ? <div className="h-40 animate-pulse rounded-lg bg-muted" /> : orders.length ? <div className="space-y-3">{orders.map((order) => <article key={order.id} className="rounded-xl border border-border p-4">
          <div className="grid gap-4 xl:grid-cols-[1fr_0.9fr_auto] xl:items-end">
            <div><div className="flex flex-wrap items-center gap-2"><Link href={`/purchase/${order.id}`} className="text-lg font-semibold text-signal-cyan-ink hover:underline">{order.po_no} · Revision {order.current_revision_no}</Link><StateBadge value={order.status} /></div><p className="mt-2 text-sm font-medium text-muted-foreground">{order.supplier_name}</p><p className="mt-1 text-xs text-muted-foreground">{order.lines.length} lines · {order.lines.reduce((sum, line) => sum + line.qty_ordered, 0).toLocaleString("en-IN")} kg · ₹{order.lines.reduce((sum, line) => sum + line.qty_ordered * line.unit_cost, 0).toLocaleString("en-IN")}</p></div>
            <Field label="Decision reason"><input className={fieldClass} value={reason[order.id] || ""} onChange={(e) => setReason({ ...reason, [order.id]: e.target.value })} placeholder="What was checked or why rejected" /></Field>
            <div className="flex gap-2"><button className={primaryButton} disabled={approve.isPending} onClick={() => approve.mutate(order)}><CheckCircle2 className="h-4 w-4" /> Approve</button><button className={secondaryButton} disabled={(reason[order.id] || "").trim().length < 3 || reject.isPending} onClick={() => reject.mutate(order)}><XCircle className="h-4 w-4" /> Reject</button></div>
          </div>
        </article>)}</div> : <EmptyState label="No submitted purchase order revisions need approval." />}
      </WorkPanel>
    </ProcurementShell>
  </RoleGate>
}
