"use client"
import Link from "next/link"
import { useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { purchaseApi } from "@/lib/api"
import { businessDate } from "@/lib/business-date"
import { useAuth } from "@/context/AuthContext"
import { RoleGate } from "@/components/workspace/role-gate"
import { Field, MessageBar, ProcurementShell, WorkPanel, fieldClass, primaryButton, secondaryButton } from "@/components/procurement/procurement-shell"
const rows = (data: any): any[] => Array.isArray(data) ? data : data?.items || []
const failure = (error: any) => typeof error?.response?.data?.detail === "string" ? error.response.data.detail : error.message || "Unable to save delivery"
export default function SupplierDeliveriesPage() {
  const { activePlant } = useAuth(); const client = useQueryClient()
  const orders = useQuery({ queryKey: ["purchase-v2", "orders", activePlant], enabled: Boolean(activePlant && activePlant !== "ALL"), queryFn: () => purchaseApi.getOrders() })
  const schedules = useQuery({ queryKey: ["purchase-v2", "supplier-deliveries", activePlant], enabled: Boolean(activePlant && activePlant !== "ALL"), queryFn: () => purchaseApi.getSchedules() })
  const [form, setForm] = useState({ order: "", line: "", quantity: "", date: businessDate(), status: "TENTATIVE" })
  const [edit, setEdit] = useState<any>(null); const [message, setMessage] = useState(""); const [error, setError] = useState("")
  useEffect(() => { setEdit(null); setForm({ order: "", line: "", quantity: "", date: businessDate(), status: "TENTATIVE" }); setMessage(""); setError("") }, [activePlant])
  const orderRows = rows(orders.data?.data); const scheduleRows = rows(schedules.data?.data)
  const selected = orderRows.find(row => row.id === form.order)
  const refresh = () => client.invalidateQueries({ queryKey: ["purchase-v2"] })
  const add = useMutation({ mutationFn: () => purchaseApi.commitSchedules(form.order, { rows: [{ purchase_order_line_id: form.line, scheduled_qty: Number(form.quantity), promised_date: form.date, current_date: form.date, confirmation_status: form.status }] }), onSuccess: () => { refresh(); setMessage("Supplier commitment saved."); setError(""); setForm({ ...form, quantity: "" }) }, onError: error => setError(failure(error)) })
  const update = useMutation({ mutationFn: () => purchaseApi.updateSchedule(edit.id, { expected_version: edit.version, current_date: edit.current_date, confirmation_status: edit.confirmation_status, reason: edit.reason }), onSuccess: () => { refresh(); setEdit(null); setError(""); setMessage("Delivery updated. The original promise and receipt quantities remain in history.") }, onError: error => setError(failure(error)) })
  return <RoleGate allow={["Planner", "Store", "PlantManager"]}><ProcurementShell eyebrow="Purchase / supplier commitments" title="Supplier deliveries" description="Track promised dates, revised arrivals and partial receipts against each purchase line." actions={<Link className={secondaryButton} href="/purchase/scheduler">Monthly purchase plan</Link>}>
    {error || orders.isError || schedules.isError ? <MessageBar tone="error">{error || "Delivery data could not load."}<button className="ml-3 underline" onClick={() => { orders.refetch(); schedules.refetch() }}>Retry</button></MessageBar> : null}
    {message ? <MessageBar tone="success">{message}</MessageBar> : null}
    <WorkPanel title="Add a delivery commitment"><form className="grid gap-3 md:grid-cols-3" onSubmit={event => { event.preventDefault(); add.mutate() }}>
      <Field label="Purchase order"><select className={fieldClass} required value={form.order} onChange={event => setForm({ ...form, order: event.target.value, line: "" })}><option value="">Select PO</option>{orderRows.filter(row => !["CANCELLED", "SHORT_CLOSED", "RECEIVED"].includes(row.status)).map(row => <option key={row.id} value={row.id}>{row.po_no} · {row.supplier_name || row.supplier_name_snapshot}</option>)}</select></Field>
      <Field label="Material line"><select className={fieldClass} required value={form.line} onChange={event => setForm({ ...form, line: event.target.value })}><option value="">Select material</option>{(selected?.lines || []).map((line: any) => <option key={line.id} value={line.id}>{line.item_code || line.item_name} · {line.qty_ordered - line.qty_received - (line.qty_short_closed || 0)} {line.uom} open</option>)}</select></Field>
      <Field label="Quantity"><input className={fieldClass} type="number" min="0.001" step="0.001" required value={form.quantity} onChange={event => setForm({ ...form, quantity: event.target.value })} /></Field>
      <Field label="Promised arrival"><input className={fieldClass} type="date" required value={form.date} onChange={event => setForm({ ...form, date: event.target.value })} /></Field>
      <Field label="Supplier confirmation"><select className={fieldClass} value={form.status} onChange={event => setForm({ ...form, status: event.target.value })}><option value="TENTATIVE">Tentative</option><option value="CONFIRMED">Confirmed</option></select></Field>
      <button className={`${primaryButton} self-end`} disabled={add.isPending || !activePlant || activePlant === "ALL"}>{add.isPending ? "Saving…" : "Save commitment"}</button>
    </form></WorkPanel>
    <WorkPanel title="Saved commitments" description="Received quantities come from GRNs. Editing a date never creates stock.">
      {schedules.isLoading ? <p>Loading supplier deliveries…</p> : !scheduleRows.length ? <p>No supplier delivery commitments yet.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[800px] text-left text-sm"><thead><tr>{["PO / material", "Promised", "Current arrival", "Scheduled", "Received", "Remaining", "State", ""].map(label => <th key={label} className="p-3">{label}</th>)}</tr></thead><tbody>{scheduleRows.map(row => <tr key={row.id} className="border-t"><td className="p-3">{row.po_no}<p className="text-xs text-muted-foreground">{row.item_code}</p>{row.change_history?.length ? <details className="mt-2 text-xs"><summary className="cursor-pointer text-signal-cyan-ink">Revision history</summary>{row.change_history.map((entry: any) => <p className="mt-2" key={entry.version}>v{entry.version}: {entry.previous_date} → {entry.current_date} · {entry.status}<br />{entry.reason} · {entry.actor}</p>)}</details> : null}</td><td className="p-3">{row.promised_date}</td><td className="p-3">{row.current_date}</td><td className="p-3">{row.scheduled_qty}</td><td className="p-3">{row.allocated_qty}</td><td className="p-3">{row.remaining_qty}</td><td className="p-3">{row.confirmation_status}</td><td className="p-3"><button className={secondaryButton} disabled={row.confirmation_status === "CANCELLED"} onClick={() => { setEdit({ ...row, reason: "" }); setError("") }}>Revise</button></td></tr>)}</tbody></table></div>}
    </WorkPanel>
    {edit ? <WorkPanel title={`Revise ${edit.po_no} · ${edit.item_code}`}><form className="grid gap-3 md:grid-cols-3" onSubmit={event => { event.preventDefault(); update.mutate() }}>
      <Field label="Revised arrival"><input className={fieldClass} type="date" required value={edit.current_date} onChange={event => setEdit({ ...edit, current_date: event.target.value })} /></Field>
      <Field label="Confirmation"><select className={fieldClass} value={edit.confirmation_status} onChange={event => setEdit({ ...edit, confirmation_status: event.target.value })}><option value="TENTATIVE">Tentative</option><option value="CONFIRMED">Confirmed</option><option value="CANCELLED">Cancel remaining commitment</option></select></Field>
      <Field label="Reason"><input className={fieldClass} required minLength={3} value={edit.reason} onChange={event => setEdit({ ...edit, reason: event.target.value })} /></Field>
      <button className={primaryButton} disabled={update.isPending}>{update.isPending ? "Saving…" : "Save revision"}</button><button type="button" className={secondaryButton} onClick={() => setEdit(null)}>Close</button>
    </form></WorkPanel> : null}
  </ProcurementShell></RoleGate>
}
