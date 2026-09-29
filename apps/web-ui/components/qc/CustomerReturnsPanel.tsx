"use client"

import { useMemo, useState } from "react"

import { EmptyState, Panel, StatusBadge } from "@/components/erp/shell"
import { useApp } from "@/context/AppContext"
import { useAuth } from "@/context/AuthContext"
import {
  useCreateCustomerRejection,
  useCustomerRejections,
  useDisposeCustomerRejection,
  useInventoryItems,
  useInventoryLocations,
} from "@/hooks/use-inventory"
import { useCustomers, useReasonCodes } from "@/hooks/use-master-data"
import { inventoryApi } from "@/lib/api"

function asArray(value: any) {
  return Array.isArray(value) ? value : Array.isArray(value?.items) ? value.items : []
}

function errorText(error: any, fallback: string) {
  const detail = error?.response?.data?.detail
  if (typeof detail === "string") return detail
  if (detail?.message) return detail.message
  return error?.message || fallback
}

const DISPOSITIONS = [
  { value: "REWORK", label: "Rework", hint: "Moves to WIP; the case stays open for re-inspection." },
  { value: "SEGREGATE", label: "Segregate / sort", hint: "Moves to WIP for sorting; the case stays open." },
  { value: "HOLD", label: "Keep on hold", hint: "Stays under QC hold; the case stays open." },
  { value: "BLOCK", label: "Block", hint: "Blocked from use pending a decision; the case stays open." },
  { value: "ACCEPT", label: "Accept to stock", hint: "Released to sellable stock and closed. Held goods need an Owner/Admin who did not record the return." },
  { value: "SCRAP", label: "Scrap", hint: "Written off with a scrap voucher and closed." },
] as const

const EMPTY_FORM = {
  customer_id: "",
  customer_name: "",
  dispatch_ref: "",
  invoice_ref: "",
  item_id: "",
  rejected_qty: "",
  reason_code: "",
  reason_notes: "",
  location_id: "",
  effective_date: "",
  attachment_refs: "",
}

export function CustomerReturnsPanel() {
  const { showToast } = useApp()
  const { user } = useAuth()
  const roles = useMemo(() => new Set([user?.role, ...(user?.roles || [])].filter(Boolean) as string[]), [user?.role, user?.roles])
  const canDispose = ["Owner", "Admin", "PlantManager", "QC", "Store"].some((role) => roles.has(role))
  const itemsQuery = useInventoryItems()
  const locationsQuery = useInventoryLocations()
  const customersQuery = useCustomers()
  const returnCodes = useReasonCodes("RETURN")
  const qcRejectCodes = useReasonCodes("QC_REJECT")
  const rejectionsQuery = useCustomerRejections({ limit: 80 })
  const createRejection = useCreateCustomerRejection()
  const dispose = useDisposeCustomerRejection()
  const [form, setForm] = useState(EMPTY_FORM)
  const [lookup, setLookup] = useState<any>(null)
  const [lookupBusy, setLookupBusy] = useState(false)
  const [openCase, setOpenCase] = useState<string | null>(null)
  const [decision, setDecision] = useState({
    disposition: "REWORK",
    notes: "",
    root_cause_department: "",
    owner_department: "",
    corrective_action: "",
    closure_due_date: "",
    rework_cost: "",
    scrap_cost: "",
  })
  const finishedGoods = asArray(itemsQuery.data).filter((item: any) => String(item.type || "").toUpperCase() === "FINISHED_GOOD")
  const customers = asArray(customersQuery.data).filter((row: any) => row.active !== false && row.is_active !== false)
  const reasonCodes = [...asArray(returnCodes.data), ...asArray(qcRejectCodes.data)].filter((row: any) => row.active !== false && row.is_active !== false)
  const rejections = asArray(rejectionsQuery.data)
  const lookupLine = lookup?.lines?.find((line: any) => line.item_id === form.item_id) || null

  const checkDispatch = async () => {
    const ref = form.dispatch_ref.trim()
    if (!ref) return
    setLookupBusy(true)
    try {
      const { data } = await inventoryApi.lookupDispatchForReturn(ref)
      setLookup(data)
      if (data?.lines?.length === 1 && !form.item_id) setForm((current) => ({ ...current, item_id: data.lines[0].item_id }))
      if (!data?.found) showToast(`No dispatch "${ref}" is recorded in stock. The return can still be logged but is marked unverified.`, "error")
    } catch (error: any) {
      showToast(errorText(error, "Dispatch lookup failed."), "error")
    } finally {
      setLookupBusy(false)
    }
  }

  const submit = async () => {
    const qty = Number(form.rejected_qty)
    const customerId = form.customer_id && form.customer_id !== "__other" ? form.customer_id : ""
    if (!form.item_id || !(qty > 0) || !(customerId || form.customer_name.trim())) {
      showToast("Customer, finished good and a quantity above zero are required.", "error")
      return
    }
    if (!form.reason_code) {
      showToast("Pick the reason the customer rejected the goods.", "error")
      return
    }
    if (lookupLine && qty > Number(lookupLine.returnable_qty) + 1e-6) {
      showToast(`Only ${lookupLine.returnable_qty} of this item can still come back against ${form.dispatch_ref}.`, "error")
      return
    }
    const customer = customers.find((row: any) => String(row.id) === customerId)
    try {
      await createRejection.mutateAsync({
        item_id: form.item_id,
        rejected_qty: qty,
        customer_id: customerId || undefined,
        customer_name: (customer?.name || form.customer_name).trim(),
        dispatch_ref: form.dispatch_ref.trim() || undefined,
        invoice_ref: form.invoice_ref.trim() || undefined,
        reason_code: form.reason_code,
        reason_notes: form.reason_notes.trim() || undefined,
        location_id: form.location_id || undefined,
        effective_date: form.effective_date || undefined,
        source_job_card_id: lookupLine?.production_job_id || undefined,
        attachment_refs: form.attachment_refs
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      })
      showToast("Customer return recorded under QC hold. Inspect it from Incoming QC or decide the disposition below.", "success")
      setForm(EMPTY_FORM)
      setLookup(null)
    } catch (error: any) {
      showToast(errorText(error, "Customer return could not be recorded."), "error")
    }
  }

  const decide = async (row: any) => {
    const choice = DISPOSITIONS.find((item) => item.value === decision.disposition)
    if (!decision.notes.trim()) {
      showToast("Add a note explaining the decision.", "error")
      return
    }
    if (!window.confirm(`${choice?.label} ${row.rejected_qty} returned from ${row.customer_name}? ${choice?.hint || ""}`)) return
    try {
      await dispose.mutateAsync({
        id: row.id,
        data: {
          disposition: decision.disposition,
          notes: decision.notes.trim(),
          root_cause_department: decision.root_cause_department.trim() || undefined,
          owner_department: decision.owner_department.trim() || undefined,
          corrective_action: decision.corrective_action.trim() || undefined,
          closure_due_date: decision.closure_due_date || undefined,
          rework_cost: decision.rework_cost ? Number(decision.rework_cost) : undefined,
          scrap_cost: decision.scrap_cost ? Number(decision.scrap_cost) : undefined,
        },
      })
      showToast(`Disposition recorded: ${choice?.label}.`, "success")
      setOpenCase(null)
      setDecision((current) => ({ ...current, notes: "", corrective_action: "" }))
    } catch (error: any) {
      showToast(errorText(error, "Disposition could not be recorded."), "error")
    }
  }

  const input = "h-11 w-full rounded-xl border border-border bg-card px-3 text-sm"

  return (
    <Panel
      title="Customer returns"
      subtitle="The only way returned finished goods come back into stock: held for QC, linked to customer, dispatch and invoice."
    >
      <div className="mb-5 space-y-3 rounded-2xl border border-border p-3" data-testid="customer-return-form">
        <div className="grid gap-3 md:grid-cols-3">
          <label className="space-y-1 text-sm">
            <span className="text-[12px] font-semibold text-muted-foreground">Customer</span>
            <select className={input} value={form.customer_id} onChange={(event) => setForm((current) => ({ ...current, customer_id: event.target.value }))} data-testid="customer-return-customer">
              <option value="">Select customer</option>
              {customers.map((row: any) => (
                <option key={row.id} value={row.id}>{row.name}</option>
              ))}
              <option value="__other">Not in customer master…</option>
            </select>
            {form.customer_id === "__other" ? (
              <input className={input} placeholder="Customer name" value={form.customer_name} onChange={(event) => setForm((current) => ({ ...current, customer_name: event.target.value }))} />
            ) : null}
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-[12px] font-semibold text-muted-foreground">Dispatch reference</span>
            <div className="flex gap-2">
              <input className={input} value={form.dispatch_ref} placeholder="Dispatch / DC no." onChange={(event) => { setLookup(null); setForm((current) => ({ ...current, dispatch_ref: event.target.value })) }} onBlur={() => void checkDispatch()} data-testid="customer-return-dispatch" />
              <button type="button" disabled={lookupBusy || !form.dispatch_ref.trim()} onClick={() => void checkDispatch()} className="rounded-xl border border-border px-3 text-xs font-semibold disabled:opacity-50">Check</button>
            </div>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-[12px] font-semibold text-muted-foreground">Customer invoice no.</span>
            <input className={input} value={form.invoice_ref} onChange={(event) => setForm((current) => ({ ...current, invoice_ref: event.target.value }))} />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-[12px] font-semibold text-muted-foreground">Finished good</span>
            <select className={input} value={form.item_id} onChange={(event) => setForm((current) => ({ ...current, item_id: event.target.value }))} data-testid="customer-return-item">
              <option value="">Select finished good</option>
              {(lookup?.lines?.length ? finishedGoods.filter((item: any) => lookup.lines.some((line: any) => line.item_id === String(item.id))) : finishedGoods).map((item: any) => (
                <option key={item.id} value={item.id}>{item.item_code} - {item.name}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-[12px] font-semibold text-muted-foreground">Returned quantity</span>
            <input className={input} type="number" min="0.001" step="0.001" value={form.rejected_qty} onChange={(event) => setForm((current) => ({ ...current, rejected_qty: event.target.value }))} data-testid="customer-return-qty" />
            {lookupLine ? (
              <span className="block text-[11px] text-muted-foreground" data-testid="customer-return-returnable">
                Shipped {lookupLine.dispatched_qty} · already back {lookupLine.already_returned_qty} · up to {lookupLine.returnable_qty} more
              </span>
            ) : null}
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-[12px] font-semibold text-muted-foreground">Reason</span>
            <select className={input} value={form.reason_code} onChange={(event) => setForm((current) => ({ ...current, reason_code: event.target.value }))} data-testid="customer-return-reason">
              <option value="">Select reason</option>
              {reasonCodes.map((row: any) => (
                <option key={`${row.category}-${row.code}`} value={row.code}>{row.label || row.name || row.code}</option>
              ))}
              {!reasonCodes.some((row: any) => row.code === "CUSTOMER_REJECT") ? <option value="CUSTOMER_REJECT">Customer rejection (general)</option> : null}
            </select>
          </label>
          <label className="space-y-1 text-sm md:col-span-2">
            <span className="text-[12px] font-semibold text-muted-foreground">What the customer reported</span>
            <input className={input} value={form.reason_notes} onChange={(event) => setForm((current) => ({ ...current, reason_notes: event.target.value }))} placeholder="Defect, lot, photos received…" />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-[12px] font-semibold text-muted-foreground">Receiving location</span>
            <select className={input} value={form.location_id} onChange={(event) => setForm((current) => ({ ...current, location_id: event.target.value }))}>
              <option value="">Default location</option>
              {asArray(locationsQuery.data).map((row: any) => (
                <option key={row.id} value={row.id}>{row.code || row.name}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-[12px] font-semibold text-muted-foreground">Received on</span>
            <input className={input} type="date" value={form.effective_date} onChange={(event) => setForm((current) => ({ ...current, effective_date: event.target.value }))} />
          </label>
          <label className="space-y-1 text-sm md:col-span-2">
            <span className="text-[12px] font-semibold text-muted-foreground">Document / photo references (comma separated)</span>
            <input className={input} value={form.attachment_refs} onChange={(event) => setForm((current) => ({ ...current, attachment_refs: event.target.value }))} placeholder="Customer debit note, RMA no., photo file names" />
          </label>
        </div>
        <button type="button" data-testid="customer-return-submit" disabled={createRejection.isPending} onClick={() => void submit()} className="rounded-xl bg-rose-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
          {createRejection.isPending ? "Recording…" : "Record customer return (held for QC)"}
        </button>
      </div>

      {rejections.length === 0 ? (
        <EmptyState label="No customer returns recorded." />
      ) : (
        rejections.slice(0, 30).map((row: any) => {
          const closed = Boolean(row.closed_at) || String(row.closure_status || "").toUpperCase() === "CLOSED"
          const history = asArray(row.trace_snapshot?.disposition_history)
          return (
            <article key={row.id} className="mb-2 rounded-2xl border border-border bg-card px-4 py-3" data-testid={`customer-return-${row.id}`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">{row.customer_name} · qty {row.rejected_qty}</p>
                  <p className="text-xs text-muted-foreground">
                    {[row.reason_code, row.dispatch_ref && `DC ${row.dispatch_ref}`, row.invoice_ref && `Inv ${row.invoice_ref}`, row.trace_snapshot?.dispatch_verified === false && row.dispatch_ref ? "dispatch not found in stock" : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  {row.reason_notes ? <p className="text-xs text-muted-foreground">{row.reason_notes}</p> : null}
                  {history.length ? (
                    <p className="mt-1 text-xs text-muted-foreground">Steps: {history.map((step: any) => step.disposition).join(" → ")}</p>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge value={row.status} />
                  <StatusBadge value={closed ? "CLOSED" : row.closure_status || "OPEN"} />
                  {!closed && canDispose ? (
                    <button type="button" className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold" onClick={() => setOpenCase(openCase === row.id ? null : row.id)}>
                      {openCase === row.id ? "Close" : "Decide"}
                    </button>
                  ) : null}
                </div>
              </div>
              {openCase === row.id ? (
                <div className="mt-3 grid gap-2 border-t border-border pt-3 md:grid-cols-3" data-testid="customer-return-decision">
                  <label className="space-y-1 text-xs font-medium">Disposition
                    <select className={input} value={decision.disposition} onChange={(event) => setDecision((current) => ({ ...current, disposition: event.target.value }))}>
                      {DISPOSITIONS.map((item) => (
                        <option key={item.value} value={item.value}>{item.label}</option>
                      ))}
                    </select>
                    <span className="block text-[11px] text-muted-foreground">{DISPOSITIONS.find((item) => item.value === decision.disposition)?.hint}</span>
                  </label>
                  <label className="space-y-1 text-xs font-medium md:col-span-2">Decision note
                    <input className={input} value={decision.notes} onChange={(event) => setDecision((current) => ({ ...current, notes: event.target.value }))} placeholder="What was found and why this disposition" />
                  </label>
                  <label className="space-y-1 text-xs font-medium">Root-cause department
                    <input className={input} value={decision.root_cause_department} onChange={(event) => setDecision((current) => ({ ...current, root_cause_department: event.target.value }))} placeholder="Winding, Oven, Process, Packing, Supplier…" />
                  </label>
                  <label className="space-y-1 text-xs font-medium">Action owner
                    <input className={input} value={decision.owner_department} onChange={(event) => setDecision((current) => ({ ...current, owner_department: event.target.value }))} />
                  </label>
                  <label className="space-y-1 text-xs font-medium">Corrective action due
                    <input className={input} type="date" value={decision.closure_due_date} onChange={(event) => setDecision((current) => ({ ...current, closure_due_date: event.target.value }))} />
                  </label>
                  <label className="space-y-1 text-xs font-medium md:col-span-3">Corrective action
                    <input className={input} value={decision.corrective_action} onChange={(event) => setDecision((current) => ({ ...current, corrective_action: event.target.value }))} placeholder="What changes so this does not recur" />
                  </label>
                  <label className="space-y-1 text-xs font-medium">Rework cost (₹)
                    <input className={input} type="number" min={0} value={decision.rework_cost} onChange={(event) => setDecision((current) => ({ ...current, rework_cost: event.target.value }))} />
                  </label>
                  <label className="space-y-1 text-xs font-medium">Scrap cost (₹, blank = at item cost)
                    <input className={input} type="number" min={0} value={decision.scrap_cost} onChange={(event) => setDecision((current) => ({ ...current, scrap_cost: event.target.value }))} />
                  </label>
                  <div className="flex items-end">
                    <button type="button" data-testid="customer-return-decide" disabled={dispose.isPending} onClick={() => void decide(row)} className="h-11 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60">
                      Record decision
                    </button>
                  </div>
                </div>
              ) : null}
            </article>
          )
        })
      )}
    </Panel>
  )
}
