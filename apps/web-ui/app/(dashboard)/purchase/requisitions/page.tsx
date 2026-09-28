"use client"

import Link from "next/link"
import { useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus, CheckCircle2, XCircle, ArrowRight } from "lucide-react"
import { useAuth } from "@/context/AuthContext"
import { useInventoryItems } from "@/hooks/use-inventory"
import { api } from "@/lib/api"
import { businessDate } from "@/lib/business-date"
import { Field, MessageBar, ProcurementShell, RequestErrors, StateBadge, WorkPanel, fieldClass, areaClass, primaryButton, secondaryButton } from "@/components/procurement/procurement-shell"

export default function RequisitionsPage() {
  const { activePlant, user } = useAuth()
  const cache = useQueryClient()
  const requestId = useRef(crypto.randomUUID())
  const [form, setForm] = useState({ pr_date: businessDate(), item_id: "", quantity: "", reason: "" })
  const [notice, setNotice] = useState("")
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const owner = (user?.roles || []).includes("Owner") || user?.role === "Owner"
  const itemsQuery = useInventoryItems()
  const items = (Array.isArray(itemsQuery.data) ? itemsQuery.data : []).filter((item: any) => item.type !== "FINISHED_GOOD" && item.active !== "false")
  const selected = items.find((item: any) => item.id === form.item_id)
  const query = useQuery({ queryKey: ["purchase-requisitions", activePlant], enabled: Boolean(activePlant && activePlant !== "ALL"), queryFn: () => api.get("/api/purchase/requisitions") })
  const refresh = () => cache.invalidateQueries({ queryKey: ["purchase-requisitions"] })
  const create = useMutation({ mutationFn: () => api.post("/api/purchase/requisitions", { ...form, quantity: Number(form.quantity), request_id: requestId.current }), onSuccess: ({ data }) => { setNotice(`${data.pr_no} submitted for Owner approval.`); requestId.current = crypto.randomUUID(); setForm({ pr_date: businessDate(), item_id: "", quantity: "", reason: "" }); refresh() } })
  const decide = useMutation({ mutationFn: ({ row, decision }: { row: any; decision: string }) => api.post(`/api/purchase/requisitions/${row.id}/decision`, { decision, expected_version: row.version, reason: reasons[row.id] }), onSuccess: () => { setNotice("Decision saved in the requisition history."); refresh() } })
  return <ProcurementShell title="Purchase requisitions" eyebrow="Purchasing" description="Request tools, spares or other materials. The Owner reviews the need before purchasing creates the linked PO.">
    <RequestErrors errors={[query.error, itemsQuery.error, create.error, decide.error]} />
    {notice ? <MessageBar tone="success">{notice}</MessageBar> : null}
    <WorkPanel title="New request" description="Your signed-in identity is recorded as the requester. Material units come from the master.">
      <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); create.mutate() }}>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <Field label="Request date"><input required className={fieldClass} type="date" value={form.pr_date} onChange={(event) => setForm({ ...form, pr_date: event.target.value })} /></Field>
          <Field label="Material or tool"><select required className={fieldClass} value={form.item_id} onChange={(event) => setForm({ ...form, item_id: event.target.value })}><option value="">Select material</option>{items.map((item: any) => <option key={item.id} value={item.id}>{item.item_code} · {item.name}</option>)}</select></Field>
          <Field label={`Quantity${selected ? ` · ${selected.uom}` : ""}`}><input required type="number" min="0.001" step="0.001" className={fieldClass} value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} /></Field>
        </div>
        <Field label="Why is this needed?"><textarea required minLength={3} maxLength={2000} className={areaClass} value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} /></Field>
        <button className={primaryButton} disabled={create.isPending || !selected}><Plus className="h-4 w-4" />{create.isPending ? "Submitting…" : "Submit requisition"}</button>
      </form>
    </WorkPanel>
    <WorkPanel title={owner ? "Requests and decisions" : "Requisition register"} description="Approved requests become a PO once. Commercial PO terms still require Owner approval before inward.">
      {query.isLoading ? <p className="text-sm text-muted-foreground">Loading requests…</p> : (query.data?.data?.items || []).length === 0 ? <p className="text-sm text-muted-foreground">No requisitions yet.</p> : <div className="space-y-3">{query.data?.data?.items.map((row: any) => <article key={row.id} className="rounded-xl border border-border p-4">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-semibold">{row.pr_no} · {row.item_name}</h3><p className="mt-1 text-sm text-muted-foreground">{row.quantity} {row.uom} · {row.pr_date} · Requested by {row.requested_by}</p></div><StateBadge value={row.status} /></div>
        <p className="mt-3 text-sm">{row.reason}</p>
        {owner && row.status === "SUBMITTED" ? <div className="mt-4 flex flex-wrap gap-2"><input aria-label={`Decision reason for ${row.pr_no}`} className={`${fieldClass} sm:max-w-md`} placeholder="Approval or rejection reason" value={reasons[row.id] || ""} onChange={(event) => setReasons({ ...reasons, [row.id]: event.target.value })} /><button className={primaryButton} disabled={decide.isPending || (reasons[row.id] || "").trim().length < 3} onClick={() => decide.mutate({ row, decision: "APPROVED" })}><CheckCircle2 className="h-4 w-4" />Approve request</button><button className={secondaryButton} disabled={decide.isPending || (reasons[row.id] || "").trim().length < 3} onClick={() => decide.mutate({ row, decision: "REJECTED" })}><XCircle className="h-4 w-4" />Reject</button></div> : null}
        {row.status === "APPROVED" ? <Link className={`${secondaryButton} mt-3`} href={`/purchase/new?requisition=${row.id}`}><ArrowRight className="h-4 w-4" />Create linked PO</Link> : null}
        {row.purchase_order_id ? <Link className={`${secondaryButton} mt-3`} href={`/purchase/${row.purchase_order_id}`}>Open linked PO</Link> : null}
        <details className="mt-3 text-xs text-muted-foreground"><summary className="cursor-pointer">History</summary><ol className="mt-2 space-y-2">{row.history.map((entry: any, index: number) => <li key={index}>{entry.action} · {entry.actor} · {new Date(entry.at + (entry.at.endsWith("Z") ? "" : "Z")).toLocaleString("en-IN")} {entry.reason || entry.po_no}</li>)}</ol></details>
      </article>)}</div>}
    </WorkPanel>
  </ProcurementShell>
}
