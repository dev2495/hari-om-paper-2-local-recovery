"use client"
import { useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useAuth } from "@/context/AuthContext"
import { api } from "@/lib/api"
import { businessDate } from "@/lib/business-date"
import { Field, MessageBar, RequestErrors, WorkPanel, fieldClass, primaryButton } from "./procurement-shell"

export function BulkMaterialReturns() {
  const { activePlant } = useAuth()
  const cache = useQueryClient()
  const key = useRef(crypto.randomUUID())
  const [issueId, setIssueId] = useState("")
  const [quantity, setQuantity] = useState("")
  const [reason, setReason] = useState("")
  const [date, setDate] = useState(businessDate())
  const query = useQuery({ queryKey: ["production-returnable", activePlant], enabled: !!activePlant && activePlant !== "ALL", queryFn: () => api.get("/api/inventory/issue/returnable") })
  const rows = query.data?.data?.items || []
  const selected = rows.find((row: any) => row.id === issueId)
  const save = useMutation({ mutationFn: () => api.post("/api/inventory/issue/returns", { request_id: key.current, issue_id: issueId, quantity: Number(quantity), effective_date: date, reason }), onSuccess: () => { key.current = crypto.randomUUID(); setIssueId(""); setQuantity(""); setReason(""); cache.invalidateQueries({ queryKey: ["production-returnable"] }); cache.invalidateQueries({ queryKey: ["inventory"] }) } })
  return <WorkPanel title="Return unused material" description="Return against a manual production issue. This reduces net issued quantity; monthly physical reconciliation determines actual consumption. WIP transfers return through Stock control.">
    <RequestErrors errors={[query.error, save.error]} />
    {save.isSuccess ? <MessageBar tone="success">Return recorded against the original issue and batch.</MessageBar> : null}
    {query.isLoading ? <p>Loading outstanding issues…</p> : !rows.length ? <p className="text-sm text-muted-foreground">No outstanding manual issues in this plant.</p> : <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); save.mutate() }}>
      <Field label="Original issue"><select required className={fieldClass} value={issueId} onChange={(event) => { setIssueId(event.target.value); setQuantity("") }}><option value="">Select issued material and batch</option>{rows.map((row: any) => <option key={row.id} value={row.id}>{row.item_code} · {row.batch_no} · {row.issue_date} · {row.returnable} {row.uom} outstanding</option>)}</select></Field>
      <div className="grid gap-3 sm:grid-cols-2"><Field label={`Return quantity${selected ? ` · ${selected.uom}` : ""}`}><input required type="number" min="0.001" step="0.001" max={selected?.returnable} className={fieldClass} value={quantity} onChange={(event) => setQuantity(event.target.value)} /></Field><Field label="Return date"><input required type="date" min={selected?.issue_date} max={businessDate()} className={fieldClass} value={date} onChange={(event) => setDate(event.target.value)} /></Field></div>
      <Field label="Return reason"><input required minLength={3} maxLength={1000} className={fieldClass} value={reason} onChange={(event) => setReason(event.target.value)} /></Field>
      <button className={primaryButton} disabled={!selected || save.isPending}>{save.isPending ? "Recording return…" : "Record material return"}</button>
    </form>}
  </WorkPanel>
}
