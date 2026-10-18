"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, CheckCircle2, ChevronDown, ClipboardCheck, ListChecks, Plus, RotateCcw, Search, Undo2, X } from "lucide-react"

import { QualityDeskNav } from "@/components/qc/QualityDeskNav"
import { Field, fieldClass } from "@/components/procurement/procurement-shell"
import { PageHeader } from "@/components/workspace/page-header"
import { RoleGate } from "@/components/workspace/role-gate"
import { ErrorState, LoadingState } from "@/components/workspace/query-state"
import { useApp } from "@/context/AppContext"
import { useAuth } from "@/context/AuthContext"
import { useCreateCustomerRejection, useCustomerRejections, useDisposeCustomerRejection, useInventoryItems, useInventoryLocations } from "@/hooks/use-inventory"
import { useCreateReasonCode, useCustomers, useReasonCodes, useTubeSizes } from "@/hooks/use-master-data"
import { inventoryApi } from "@/lib/api"
import { cn } from "@/lib/utils"

const asArray = (value: any) => (Array.isArray(value) ? value : Array.isArray(value?.items) ? value.items : [])
const errorText = (error: any, fallback: string) => {
  const detail = error?.response?.data?.detail
  if (typeof detail === "string") return detail
  if (detail?.message) return detail.message
  return error?.message || fallback
}
const day = (value?: string | null) => value ? new Date(/T/.test(value) && !/Z$|[+-]\d{2}:\d{2}$/.test(value) ? `${value}Z` : value).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—"
const today = () => new Date().toISOString().slice(0, 10)

const DISPOSITIONS = [
  { value: "REWORK", label: "Rework", hint: "Goes to WIP for rework; the complaint stays open until it is re-inspected." },
  { value: "SEGREGATE", label: "Sort / segregate", hint: "Goes to WIP for sorting; the complaint stays open until the result is decided." },
  { value: "HOLD", label: "Keep on hold", hint: "Stays under QC hold; the complaint stays open." },
  { value: "BLOCK", label: "Block", hint: "Blocked from use pending a decision; the complaint stays open." },
  { value: "ACCEPT", label: "Accept to stock", hint: "Released to sellable stock and the complaint closes. Held goods need an Owner/Admin who did not record it." },
  { value: "SCRAP", label: "Scrap", hint: "Written off with a scrap voucher and the complaint closes." },
] as const

// Starter list for the "Customer complaints" master; the client keeps adding their own.
const COMMON_REASONS = [
  ["CC-DAMAGE", "Crushed / damaged tubes"],
  ["CC-SIZE", "Size out of tolerance (I.D. / O.D. / length)"],
  ["CC-STRENGTH", "Low crushing strength"],
  ["CC-MOISTURE", "Moisture / soft tubes"],
  ["CC-QTY", "Short or wrong quantity"],
  ["CC-FINISH", "Finish, colour or print issue"],
  ["CC-PACKING", "Packing issue"],
  ["CC-OTHER", "Other"],
]

const EMPTY_FORM = { customer_id: "", customer_name: "", complaint_batch: "", item_id: "", size_label: "", rejected_qty: "", reason_code: "", reason_notes: "", dispatch_ref: "", invoice_ref: "", location_id: "", effective_date: "", attachment_refs: "" }
const EMPTY_DECISION = { disposition: "REWORK", notes: "", root_cause_department: "", owner_department: "", corrective_action: "", closure_due_date: "", rework_cost: "", scrap_cost: "" }
const STEPS = ["Received & held", "QC decision", "Rework / sort", "Closed"]

/** Where a complaint stands and what has to happen next. */
function caseState(row: any) {
  const closed = Boolean(row.closed_at) || String(row.closure_status || "").toUpperCase() === "CLOSED"
  const history = asArray(row.trace_snapshot?.disposition_history)
  const last = String(row.disposition || "").toUpperCase()
  const overdue = !closed && row.closure_due_date && String(row.closure_due_date) < today()
  if (closed) return { step: 3, status: last === "SCRAP" ? "Closed · scrapped" : last === "ACCEPT" ? "Closed · accepted back" : "Closed", tone: "done", next: last === "SCRAP" ? "Closed — scrapped" : "Closed — accepted back to stock", overdue: false, history }
  if (!last) return { step: 0, status: "Open · with QC", tone: "action", next: "QC to inspect the returned goods and record a decision", overdue, history }
  if (["REWORK", "SEGREGATE"].includes(last)) return { step: 2, status: last === "REWORK" ? "In rework" : "Sorting", tone: "wait", next: `${last === "REWORK" ? "Rework" : "Sorting"} in progress — re-inspect, then accept to stock or scrap`, overdue, history }
  return { step: 1, status: last === "BLOCK" ? "Blocked" : "On hold", tone: "action", next: `${last === "BLOCK" ? "Blocked" : "On hold"} — decide: rework, sort, accept or scrap`, overdue, history }
}

export default function CustomerComplaintsPage() {
  const { showToast } = useApp()
  const { user } = useAuth()
  const roles = useMemo(() => new Set([user?.role, ...(user?.roles || [])].filter(Boolean) as string[]), [user?.role, user?.roles])
  const canRecord = ["Owner", "Admin", "PlantManager", "QC", "Store", "Sales", "Dispatch"].some((role) => roles.has(role))
  const canDecide = ["Owner", "Admin", "PlantManager", "QC", "Store"].some((role) => roles.has(role))
  const canEditMaster = ["Owner", "Admin"].some((role) => roles.has(role))
  const rejections = useCustomerRejections({ limit: 300 })
  const items = useInventoryItems()
  const locations = useInventoryLocations()
  const customersQuery = useCustomers()
  const tubeSizes = useTubeSizes()
  const complaintReasons = useReasonCodes("CUSTOMER_COMPLAINT")
  const legacyReasons = useReasonCodes("RETURN")
  const createReason = useCreateReasonCode()
  const create = useCreateCustomerRejection()
  const dispose = useDisposeCustomerRejection()
  const [view, setView] = useState<"open" | "closed" | "all">("open")
  const [search, setSearch] = useState("")
  const [reasonFilter, setReasonFilter] = useState("")
  const [recording, setRecording] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [lookup, setLookup] = useState<any>(null)
  const [lookupBusy, setLookupBusy] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [decision, setDecision] = useState(EMPTY_DECISION)

  // Deep link from a notification: /quality/returns?case=<id>
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("case")
    if (wanted) { setSelectedId(wanted); setView("all") }
  }, [])

  const finishedGoods = asArray(items.data).filter((item: any) => String(item.type || "").toUpperCase() === "FINISHED_GOOD")
  const customers = asArray(customersQuery.data).filter((row: any) => row.active !== false && row.is_active !== false)
  const reasons = asArray(complaintReasons.data).filter((row: any) => row.active !== false && row.is_active !== false)
  const reasonLabel = (code: string) => [...reasons, ...asArray(legacyReasons.data)].find((row: any) => row.code === code)?.label || String(code || "").replace(/_/g, " ").toLowerCase()
  const sizeOptions = [...new Set(asArray(tubeSizes.data).map((row: any) => `${row.inner_diameter_mm} × ${row.outer_diameter_mm} × ${row.length_mm}`))]
  const itemName = (id: string) => { const item = asArray(items.data).find((row: any) => String(row.id) === String(id)); return item ? `${item.item_code} · ${item.name}` : "Finished good" }
  const rows: any[] = asArray(rejections.data)
  const states = rows.map((row) => ({ row, state: caseState(row) }))
  const open = states.filter(({ state }) => state.step < 3)
  const counts = {
    open: open.length,
    awaiting: open.filter(({ state }) => state.tone === "action").length,
    inWork: open.filter(({ state }) => state.step === 2).length,
    overdue: open.filter(({ state }) => state.overdue).length,
    closed: states.length - open.length,
  }
  const visible = states.filter(({ row, state }) => (view === "all" || (view === "open") === (state.step < 3))
    && (!reasonFilter || row.reason_code === reasonFilter)
    && `${row.customer_name} ${row.complaint_batch || ""} ${row.size_label || ""} ${row.dispatch_ref || ""} ${row.invoice_ref || ""} ${reasonLabel(row.reason_code)} ${itemName(row.item_id)}`.toLowerCase().includes(search.toLowerCase()))
  const selected = states.find(({ row }) => row.id === selectedId)
  const lookupLine = lookup?.lines?.find((line: any) => line.item_id === form.item_id) || null

  const addCommonReasons = async () => {
    try {
      for (const [code, label] of COMMON_REASONS) {
        await createReason.mutateAsync({ code, label, category: "CUSTOMER_COMPLAINT", severity: "WATCH", description: "Customer complaint reason" })
      }
      showToast("Common complaint reasons added. Edit or add more in Masters › Reason codes.", "success")
    } catch (error: any) { showToast(errorText(error, "Reasons could not be added."), "error") }
  }

  const checkDispatch = async () => {
    const ref = form.dispatch_ref.trim()
    if (!ref) return
    setLookupBusy(true)
    try {
      const { data } = await inventoryApi.lookupDispatchForReturn(ref)
      setLookup(data)
      if (data?.lines?.length === 1 && !form.item_id) setForm((current) => ({ ...current, item_id: data.lines[0].item_id }))
      if (!data?.found) showToast(`No dispatch "${ref}" is recorded in stock. The complaint can still be logged but is marked unverified.`, "error")
    } catch (error: any) {
      showToast(errorText(error, "Dispatch lookup failed."), "error")
    } finally { setLookupBusy(false) }
  }

  const record = async () => {
    const qty = Number(form.rejected_qty)
    const customerId = form.customer_id && form.customer_id !== "__other" ? form.customer_id : ""
    if (!(customerId || form.customer_name.trim())) return showToast("Choose the customer.", "error")
    if (!form.complaint_batch.trim()) return showToast("Enter the batch on the goods (job card / batch number).", "error")
    if (!form.item_id) return showToast("Choose the product (finished good).", "error")
    if (!(qty > 0)) return showToast("Enter the quantity complained about.", "error")
    if (!form.reason_code) return showToast("Pick the reason from the Customer complaints master.", "error")
    if (lookupLine && qty > Number(lookupLine.returnable_qty) + 1e-6) return showToast(`Only ${lookupLine.returnable_qty} of this product can still come back against ${form.dispatch_ref}.`, "error")
    const customer = customers.find((row: any) => String(row.id) === customerId)
    try {
      const { data } = await create.mutateAsync({
        item_id: form.item_id, rejected_qty: qty, customer_id: customerId || undefined, customer_name: (customer?.name || form.customer_name).trim(),
        complaint_batch: form.complaint_batch.trim(), size_label: form.size_label.trim() || undefined,
        dispatch_ref: form.dispatch_ref.trim() || undefined, invoice_ref: form.invoice_ref.trim() || undefined, reason_code: form.reason_code,
        reason_notes: form.reason_notes.trim() || undefined, location_id: form.location_id || undefined, effective_date: form.effective_date || undefined,
        source_job_card_id: lookupLine?.production_job_id || undefined,
        attachment_refs: form.attachment_refs.split(",").map((item) => item.trim()).filter(Boolean),
      })
      showToast("Complaint recorded; goods held for QC. QC, the plant head and Sales are notified.", "success")
      setForm(EMPTY_FORM); setLookup(null); setRecording(false); setMoreOpen(false)
      if (data?.id) { setSelectedId(String(data.id)); setDecision(EMPTY_DECISION) }
    } catch (error: any) {
      showToast(errorText(error, "Complaint could not be recorded."), "error")
    }
  }

  const decide = async (row: any) => {
    const choice = DISPOSITIONS.find((item) => item.value === decision.disposition)
    if (!decision.notes.trim()) return showToast("Add a note explaining the decision.", "error")
    if (!window.confirm(`${choice?.label}: ${row.rejected_qty} from ${row.customer_name}? ${choice?.hint || ""}`)) return
    try {
      await dispose.mutateAsync({ id: row.id, data: {
        disposition: decision.disposition, notes: decision.notes.trim(),
        root_cause_department: decision.root_cause_department.trim() || undefined, owner_department: decision.owner_department.trim() || undefined,
        corrective_action: decision.corrective_action.trim() || undefined, closure_due_date: decision.closure_due_date || undefined,
        rework_cost: decision.rework_cost ? Number(decision.rework_cost) : undefined, scrap_cost: decision.scrap_cost ? Number(decision.scrap_cost) : undefined,
      } })
      showToast(`Decision recorded: ${choice?.label}.`, "success")
      setDecision(EMPTY_DECISION)
    } catch (error: any) {
      showToast(errorText(error, "Decision could not be recorded."), "error")
    }
  }

  const stepper = (step: number) => (
    <ol className="flex flex-wrap items-center gap-1.5 text-[11.5px]" aria-label="Complaint progress">
      {STEPS.map((label, index) => (
        <li key={label} className="flex items-center gap-1.5">
          <span className={cn("rounded-full px-2 py-0.5 font-semibold ring-1 ring-inset", index < step || step === 3 ? "bg-signal-emerald-soft text-signal-emerald-ink ring-signal-emerald-line" : index === step ? "bg-signal-amber-soft text-signal-amber-ink ring-signal-amber-line" : "bg-muted text-muted-foreground ring-border")}>{label}</span>
          {index < STEPS.length - 1 ? <span aria-hidden="true" className="text-muted-foreground">›</span> : null}
        </li>
      ))}
    </ol>
  )
  const statusChip = (state: ReturnType<typeof caseState>) => (
    <span className={cn("whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-semibold ring-1 ring-inset", state.tone === "done" ? "bg-signal-emerald-soft text-signal-emerald-ink ring-signal-emerald-line" : state.tone === "wait" ? "bg-signal-cyan-soft text-signal-cyan-ink ring-signal-cyan-line" : "bg-signal-amber-soft text-signal-amber-ink ring-signal-amber-line")}>{state.status}</span>
  )

  return (
    <RoleGate allow={["QC", "PlantManager", "Store", "Sales", "Dispatch"]}>
      <div className="space-y-5" data-testid="customer-returns-page">
        <PageHeader title="Customer complaints" description="Every customer complaint or return in one register — batch, customer, size, quantity, reason and status. Goods come back held for QC, QC decides, and each complaint is followed to closure with its root cause and corrective action." actions={canRecord ? <button type="button" className="erp-btn-primary" onClick={() => setRecording(true)}><Plus className="h-4 w-4" />New complaint</button> : null} />
        <QualityDeskNav />

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {[
            { label: "Open complaints", value: counts.open, icon: Undo2, tone: "" },
            { label: "Waiting for QC decision", value: counts.awaiting, icon: ClipboardCheck, tone: counts.awaiting ? "text-signal-amber-ink" : "" },
            { label: "In rework / sorting", value: counts.inWork, icon: RotateCcw, tone: "" },
            { label: "Corrective action overdue", value: counts.overdue, icon: AlertTriangle, tone: counts.overdue ? "text-signal-rose-ink" : "" },
            { label: "Closed", value: counts.closed, icon: CheckCircle2, tone: "" },
          ].map((kpi) => (
            <div key={kpi.label} className="rounded-xl border border-border bg-card p-3.5">
              <div className="flex items-center justify-between text-[12px] font-semibold text-muted-foreground">{kpi.label}<kpi.icon className="h-4 w-4" aria-hidden="true" /></div>
              <p className={cn("mt-1.5 text-2xl font-semibold tabular-nums", kpi.tone)}>{rejections.isLoading ? "…" : kpi.value}</p>
            </div>
          ))}
        </div>

        {!complaintReasons.isLoading && !reasons.length ? (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-signal-amber-line bg-signal-amber-soft px-4 py-3 text-[13px] text-signal-amber-ink">
            <ListChecks className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1">The <b>Customer complaints</b> reason master is empty. Reasons come from Masters › Reason codes (category Customer complaints).</span>
            {canEditMaster ? <button type="button" className="erp-btn-secondary !h-9" disabled={createReason.isPending} onClick={() => void addCommonReasons()}>Add common reasons</button> : null}
            <Link className="font-semibold underline" href="/masters/reason-codes?category=CUSTOMER_COMPLAINT">Open the master</Link>
          </div>
        ) : null}

        {recording ? (
          <section className="rounded-xl border border-primary/30 bg-card" data-testid="customer-return-form">
            <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
              <div><h2 className="font-semibold">New complaint</h2><p className="text-[12.5px] text-muted-foreground">The goods come in under QC hold. Nothing is sellable until QC decides.</p></div>
              <button type="button" className="grid h-9 w-9 place-items-center rounded-lg hover:bg-muted" aria-label="Close form" onClick={() => setRecording(false)}><X className="h-4 w-4" /></button>
            </header>
            <div className="grid gap-3 p-4 md:grid-cols-3">
              <Field label="Customer">
                <select className={fieldClass} value={form.customer_id} onChange={(e) => setForm({ ...form, customer_id: e.target.value })} data-testid="customer-return-customer">
                  <option value="">Select customer</option>
                  {customers.map((row: any) => <option key={row.id} value={row.id}>{row.name}</option>)}
                  <option value="__other">Not in customer master…</option>
                </select>
              </Field>
              {form.customer_id === "__other" ? <Field label="Customer name"><input className={fieldClass} value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} /></Field> : null}
              <Field label="Batch" hint="job card / batch no. on the goods"><input className={fieldClass} value={form.complaint_batch} onChange={(e) => setForm({ ...form, complaint_batch: e.target.value })} placeholder="e.g. 26/10/11" data-testid="customer-return-batch" /></Field>
              <Field label="Product">
                <select className={fieldClass} value={form.item_id} onChange={(e) => setForm({ ...form, item_id: e.target.value })} data-testid="customer-return-item">
                  <option value="">Select finished good</option>
                  {(lookup?.lines?.length ? finishedGoods.filter((item: any) => lookup.lines.some((line: any) => line.item_id === String(item.id))) : finishedGoods).map((item: any) => <option key={item.id} value={item.id}>{item.item_code} · {item.name}</option>)}
                </select>
              </Field>
              <Field label="Size" hint="I.D. × O.D. × length">
                <input className={fieldClass} list="complaint-sizes" value={form.size_label} onChange={(e) => setForm({ ...form, size_label: e.target.value })} placeholder="e.g. 76.4 × 81 × 150" data-testid="customer-return-size" />
                <datalist id="complaint-sizes">{sizeOptions.map((size: string) => <option key={size} value={size} />)}</datalist>
              </Field>
              <Field label="Quantity" hint={lookupLine ? `up to ${lookupLine.returnable_qty} more` : "pcs"}>
                <input className={fieldClass} type="number" min="0.001" step="0.001" value={form.rejected_qty} onChange={(e) => setForm({ ...form, rejected_qty: e.target.value })} data-testid="customer-return-qty" />
              </Field>
              <Field label="Reason" hint="Customer complaints master">
                <select className={fieldClass} value={form.reason_code} onChange={(e) => setForm({ ...form, reason_code: e.target.value })} data-testid="customer-return-reason">
                  <option value="">Select reason</option>
                  {reasons.map((row: any) => <option key={row.code} value={row.code}>{row.label || row.code}</option>)}
                </select>
              </Field>
              <div className="md:col-span-3"><Field label="What the customer said" hint="optional"><input className={fieldClass} value={form.reason_notes} onChange={(e) => setForm({ ...form, reason_notes: e.target.value })} placeholder="Defect seen, photos received…" /></Field></div>
            </div>
            <div className="border-t border-border px-4 py-2">
              <button type="button" className="flex items-center gap-1.5 py-1 text-[13px] font-semibold text-primary" onClick={() => setMoreOpen(!moreOpen)} aria-expanded={moreOpen}><ChevronDown className={cn("h-4 w-4 transition-transform", moreOpen && "rotate-180")} />More details (dispatch, invoice, location, date, documents)</button>
              {moreOpen ? (
                <div className="grid gap-3 pb-2 pt-2 md:grid-cols-3">
                  <Field label="Dispatch / DC no." hint="checks what was shipped">
                    <div className="flex gap-2">
                      <input className={fieldClass} value={form.dispatch_ref} onChange={(e) => { setLookup(null); setForm({ ...form, dispatch_ref: e.target.value }) }} onBlur={() => void checkDispatch()} data-testid="customer-return-dispatch" />
                      <button type="button" className="erp-btn-secondary !h-9" disabled={lookupBusy || !form.dispatch_ref.trim()} onClick={() => void checkDispatch()}>Check</button>
                    </div>
                  </Field>
                  <Field label="Customer invoice no."><input className={fieldClass} value={form.invoice_ref} onChange={(e) => setForm({ ...form, invoice_ref: e.target.value })} /></Field>
                  <Field label="Receiving location">
                    <select className={fieldClass} value={form.location_id} onChange={(e) => setForm({ ...form, location_id: e.target.value })}>
                      <option value="">Default location</option>
                      {asArray(locations.data).map((row: any) => <option key={row.id} value={row.id}>{row.code || row.name}</option>)}
                    </select>
                  </Field>
                  <Field label="Received on"><input className={fieldClass} type="date" value={form.effective_date} onChange={(e) => setForm({ ...form, effective_date: e.target.value })} /></Field>
                  <div className="md:col-span-2"><Field label="Documents / photos" hint="comma separated"><input className={fieldClass} value={form.attachment_refs} onChange={(e) => setForm({ ...form, attachment_refs: e.target.value })} placeholder="Customer debit note, RMA no., photo file names" /></Field></div>
                </div>
              ) : null}
            </div>
            <div className="flex gap-2 border-t border-border px-4 py-3">
              <button type="button" className="erp-btn-primary" data-testid="customer-return-submit" disabled={create.isPending} onClick={() => void record()}>{create.isPending ? "Recording…" : "Record complaint (held for QC)"}</button>
              <button type="button" className="erp-btn-secondary" onClick={() => setRecording(false)}>Cancel</button>
            </div>
          </section>
        ) : null}

        <div className="grid items-start gap-4 2xl:grid-cols-[minmax(0,1fr)_440px]">
          <section className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
              <div role="tablist" aria-label="Complaints" className="flex gap-1 rounded-lg bg-muted p-1">
                {([["open", `Open ${counts.open}`], ["closed", `Closed ${counts.closed}`], ["all", `All ${rows.length}`]] as const).map(([value, label]) => (
                  <button key={value} type="button" role="tab" aria-selected={view === value} onClick={() => setView(value)} className={cn("min-h-8 rounded-md px-3 text-[12.5px] font-semibold", view === value ? "bg-card shadow-sm ring-1 ring-border" : "text-muted-foreground hover:text-foreground")}>{label}</button>
                ))}
              </div>
              <label className="flex h-9 min-w-[200px] flex-1 items-center gap-2 rounded-lg border border-input px-3"><Search className="h-4 w-4 text-muted-foreground" aria-hidden="true" /><input className="w-full bg-transparent text-sm outline-none" placeholder="Customer, batch, size, product…" aria-label="Search complaints" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
              <select className={cn(fieldClass, "w-auto")} aria-label="Reason" value={reasonFilter} onChange={(e) => setReasonFilter(e.target.value)}>
                <option value="">Every reason</option>
                {reasons.map((row: any) => <option key={row.code} value={row.code}>{row.label}</option>)}
              </select>
            </div>
            {rejections.isLoading ? <LoadingState label="Loading complaints…" /> : rejections.isError ? <ErrorState message="Complaints could not be loaded." onRetry={() => rejections.refetch()} /> : visible.length ? (
              <div className="overflow-x-auto">
                <table className="tube-grid w-full min-w-[860px]" data-testid="complaint-register">
                  <thead><tr><th>Date</th><th>Customer</th><th>Batch</th><th>Size</th><th className="text-right">Qty</th><th>Reason</th><th>Status</th><th>Next step</th></tr></thead>
                  <tbody>
                    {visible.map(({ row, state }) => (
                      <tr key={row.id} className={cn("cursor-pointer", selectedId === row.id && "bg-primary/5")} onClick={() => { setSelectedId(row.id); setDecision(EMPTY_DECISION) }} data-testid={`customer-return-${row.id}`}>
                        <td className="whitespace-nowrap">{day(row.effective_date || row.created_at)}</td>
                        <td className="font-medium">{row.customer_name}<span className="block text-[11.5px] font-normal text-muted-foreground">{itemName(row.item_id)}</span></td>
                        <td>{row.complaint_batch || <span className="text-muted-foreground">—</span>}</td>
                        <td className="whitespace-nowrap">{row.size_label || <span className="text-muted-foreground">—</span>}</td>
                        <td className="text-right tabular-nums">{row.rejected_qty}</td>
                        <td>{reasonLabel(row.reason_code)}</td>
                        <td>{statusChip(state)}{state.overdue ? <span className="mt-1 block text-[11px] font-semibold text-signal-rose-ink">Action overdue</span> : null}</td>
                        <td className="max-w-[260px] text-[12.5px] text-muted-foreground">{state.next}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="px-6 py-10 text-center"><Undo2 className="mx-auto mb-2 h-7 w-7 text-muted-foreground" aria-hidden="true" /><p className="font-semibold">{rows.length ? "No complaints match" : "No customer complaints yet"}</p><p className="mt-1 text-sm text-muted-foreground">{rows.length ? "Change the filter or search." : "Use “New complaint” when a customer complains or sends goods back."}</p></div>
            )}
          </section>

          <aside className="rounded-xl border border-border bg-card 2xl:sticky 2xl:top-20" data-testid="customer-return-case">
            {selected ? (() => {
              const { row, state } = selected
              const closed = state.step === 3
              const choice = DISPOSITIONS.find((item) => item.value === decision.disposition)
              return (
                <div>
                  <header className="border-b border-border px-4 py-3">
                    <div className="flex items-start justify-between gap-2"><p className="text-[11.5px] font-semibold text-muted-foreground">Complaint</p>{statusChip(state)}</div>
                    <h2 className="text-lg font-semibold">{row.customer_name}</h2>
                    <p className="text-[12.5px] text-muted-foreground">{row.rejected_qty} pcs · {itemName(row.item_id)}</p>
                    <div className="mt-2">{stepper(state.step)}</div>
                  </header>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2 px-4 py-3 text-[12.5px]">
                    {[["Batch", row.complaint_batch || "—"], ["Size", row.size_label || "—"], ["Reason", reasonLabel(row.reason_code)], ["Received", day(row.effective_date || row.created_at)], ["Dispatch", row.dispatch_ref || "—"], ["Invoice", row.invoice_ref || "—"], ["Stock status", String(row.status || "").replace(/_/g, " ").toLowerCase()], ["Root cause", row.root_cause_department || "—"], ["Action owner", row.owner_department || "—"], ["Action due", row.closure_due_date ? day(row.closure_due_date) : "—"], ["Cost impact", `₹${Number(row.cost_impact || 0).toLocaleString("en-IN")}`]].map(([label, value]) => (
                      <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="font-medium">{value}</dd></div>
                    ))}
                  </dl>
                  {row.reason_notes ? <p className="mx-4 mb-3 rounded-lg bg-muted px-3 py-2 text-[12.5px]">Customer said: {row.reason_notes}</p> : null}
                  {row.corrective_action ? <p className="mx-4 mb-3 rounded-lg bg-muted px-3 py-2 text-[12.5px]">Corrective action: {row.corrective_action}</p> : null}
                  <section className="border-t border-border px-4 py-3">
                    <h3 className="text-sm font-semibold">Timeline</h3>
                    <ol className="mt-2 space-y-2 border-l border-border pl-3 text-[12.5px]">
                      <li><span className="font-medium">Recorded and held for QC</span><span className="text-muted-foreground"> · {day(row.created_at)}</span></li>
                      {state.history.map((step: any, index: number) => (
                        <li key={index}><span className="font-medium">{DISPOSITIONS.find((item) => item.value === step.disposition)?.label || step.disposition}</span><span className="text-muted-foreground"> · {day(step.at)} · {step.actor || "—"}</span>{step.notes ? <p className="text-muted-foreground">{step.notes}</p> : null}</li>
                      ))}
                      {closed ? <li className="font-medium text-signal-emerald-ink">Closed · {day(row.closed_at)}</li> : <li className="font-medium text-signal-amber-ink">Next: {state.next}</li>}
                    </ol>
                  </section>
                  {!closed && canDecide ? (
                    <section className="space-y-3 border-t border-border px-4 py-3" data-testid="customer-return-decision">
                      <h3 className="text-sm font-semibold">Record the next decision</h3>
                      <Field label="Decision">
                        <select className={fieldClass} value={decision.disposition} onChange={(e) => setDecision({ ...decision, disposition: e.target.value })}>{DISPOSITIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
                      </Field>
                      <p className="text-[12px] text-muted-foreground">{choice?.hint}</p>
                      <Field label="What QC found and why"><input className={fieldClass} value={decision.notes} onChange={(e) => setDecision({ ...decision, notes: e.target.value })} /></Field>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="Root-cause department"><input className={fieldClass} value={decision.root_cause_department} onChange={(e) => setDecision({ ...decision, root_cause_department: e.target.value })} placeholder="Winding, Oven, Packing, Supplier…" /></Field>
                        <Field label="Action owner"><input className={fieldClass} value={decision.owner_department} onChange={(e) => setDecision({ ...decision, owner_department: e.target.value })} /></Field>
                        <Field label="Corrective action due"><input className={fieldClass} type="date" value={decision.closure_due_date} onChange={(e) => setDecision({ ...decision, closure_due_date: e.target.value })} /></Field>
                        <Field label="Rework cost ₹" hint="optional"><input className={fieldClass} type="number" min={0} value={decision.rework_cost} onChange={(e) => setDecision({ ...decision, rework_cost: e.target.value })} /></Field>
                      </div>
                      <Field label="Corrective action" hint="what changes so it does not recur"><input className={fieldClass} value={decision.corrective_action} onChange={(e) => setDecision({ ...decision, corrective_action: e.target.value })} /></Field>
                      {decision.disposition === "SCRAP" ? <Field label="Scrap cost ₹" hint="blank = at item cost"><input className={fieldClass} type="number" min={0} value={decision.scrap_cost} onChange={(e) => setDecision({ ...decision, scrap_cost: e.target.value })} /></Field> : null}
                      <button type="button" className="erp-btn-primary w-full justify-center" data-testid="customer-return-decide" disabled={dispose.isPending} onClick={() => void decide(row)}>Record decision</button>
                    </section>
                  ) : null}
                </div>
              )
            })() : (
              <div className="px-5 py-10 text-center text-sm text-muted-foreground"><ClipboardCheck className="mx-auto mb-2 h-7 w-7" aria-hidden="true" />Select a complaint to see its timeline and record the next step.</div>
            )}
          </aside>
        </div>
      </div>
    </RoleGate>
  )
}
