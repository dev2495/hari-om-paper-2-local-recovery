"use client"

import { useAuth } from "@/context/AuthContext"
import { businessDate } from "@/lib/business-date"

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation, useQuery } from "@tanstack/react-query"
import { Plus, Save, Trash2 } from "lucide-react"

import { ProcurementShell, Field, MessageBar, WorkPanel, areaClass, fieldClass, primaryButton, secondaryButton } from "@/components/procurement/procurement-shell"
import { useInventoryItems } from "@/hooks/use-inventory"
import { useVendors } from "@/hooks/use-master-data"
import { purchaseApi } from "@/lib/api"

const today = () => businessDate()
type LineDraft = { logical_line_id?: string; metadata_json?: Record<string, any>; uom: string; incoming_qc_required: boolean; key: string; item_id: string; description: string; qty_ordered: string; unit_cost: string; width_mm: string; width_tolerance_mm: string; gsm: string; plybond: string; bulk: string; cobb: string; expected_unit_count: string; count_basis: "ESTIMATED" | "CONTRACTUAL" }
const emptyLine = (): LineDraft => ({ uom: "KG", incoming_qc_required: true, key: crypto.randomUUID(), item_id: "", description: "", qty_ordered: "", unit_cost: "", width_mm: "", width_tolerance_mm: "", gsm: "", plybond: "", bulk: "", cobb: "", expected_unit_count: "", count_basis: "ESTIMATED" })

function message(error: any) {
  const detail = error?.response?.data?.detail
  return typeof detail === "string" ? detail : error?.message || "Purchase order could not be saved."
}

export default function PurchaseOrderEditor({ orderId }: { orderId?: string }) {
  const { activePlant } = useAuth()
  const router = useRouter()
  const requestKey = useRef(crypto.randomUUID())
  const [changeReason, setChangeReason] = useState("")
  const existingQuery = useQuery({ queryKey: ["purchase-v2", "edit", orderId, activePlant], refetchOnWindowFocus: false, queryFn: () => purchaseApi.getOrder(orderId!), enabled: Boolean(activePlant && activePlant !== "ALL") && Boolean(orderId) })
  const existing = existingQuery.data?.data
  const vendorsQuery = useVendors()
  const itemsQuery = useInventoryItems()
  const vendors = Array.isArray(vendorsQuery.data) ? vendorsQuery.data : []
  const items = useMemo(() => (Array.isArray(itemsQuery.data) ? itemsQuery.data.filter((item: any) => String(item.type) !== "FINISHED_GOOD") : []), [itemsQuery.data])
  const [header, setHeader] = useState({ category: "RM_PM", supplier_id: "", po_date: today(), expected_date: today(), supplier_contact: "", supplier_address: "", supplier_gst_no: "", payment_terms: "60 days from invoice date.", freight_terms: "Freight included in landed rate.", tax_terms: "GST extra as applicable.", delivery_terms: "Delivery as per agreed schedule.", test_report_terms: "Attach PB/GSM/RCT/COBB test report with each delivery.", special_instruction: "FOR AMIGO INDUSTRIES UNIT-2", notes: "" })
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()])
  const [error, setError] = useState("")
  const selectedVendor = vendors.find((vendor: any) => String(vendor.id) === header.supplier_id)
  const quantities = Object.entries(lines.reduce((totals, line) => ({ ...totals, [line.uom]: (totals[line.uom] || 0) + Number(line.qty_ordered || 0) }), {} as Record<string, number>)).map(([uom, qty]) => `${qty.toLocaleString("en-IN")} ${uom}`).join(" + ")
  const totalValue = lines.reduce((sum, line) => sum + Number(line.qty_ordered || 0) * Number(line.unit_cost || 0), 0)

  const create = useMutation({ mutationFn: (data: any) => orderId ? purchaseApi.reviseOrder(orderId, { ...data, expected_version: existing.version, change_reason: changeReason }) : purchaseApi.createOrder(data), onSuccess: ({ data }) => router.push(`/purchase/${data.id}`), onError: (caught) => setError(message(caught)) })
  const setLine = (key: string, patch: Partial<LineDraft>) => setLines((current) => current.map((line) => line.key === key ? { ...line, ...patch } : line))

  useEffect(() => {
    if (!existing) return
    setHeader((current) => Object.fromEntries(Object.entries(current).map(([key, fallback]) => [key, existing[key] ?? fallback])) as typeof current)
    setLines(existing.lines.map((row: any) => ({ ...emptyLine(), ...Object.fromEntries(Object.keys(emptyLine()).filter((key) => !["key", "incoming_qc_required"].includes(key)).map((key) => [key, row[key] == null ? "" : String(row[key])])), key: row.id, logical_line_id: row.logical_line_id, incoming_qc_required: row.incoming_qc_required, metadata_json: row.metadata_json, uom: row.uom, count_basis: row.count_basis || "ESTIMATED" })))
  }, [existing])

  function submit(event: React.FormEvent) {
    event.preventDefault(); setError("")
    if (!selectedVendor || lines.some((line) => !line.item_id || Number(line.qty_ordered) <= 0 || Number(line.unit_cost) < 0)) {
      setError("Select a vendor and complete every material, quantity and rate before saving."); return
    }
    if (orderId && changeReason.trim().length < 3) { setError("Explain the vendor change before saving a new revision."); return }
    create.mutate({
      request_id: requestKey.current, category: header.category, po_date: header.po_date,
      supplier_id: selectedVendor.id, supplier_name: selectedVendor.name, expected_date: header.expected_date,
      supplier_contact: header.supplier_contact || undefined, supplier_address: header.supplier_address || undefined,
      supplier_gst_no: header.supplier_gst_no || undefined, payment_terms: header.payment_terms,
      freight_terms: header.freight_terms, tax_terms: header.tax_terms, delivery_terms: header.delivery_terms,
      test_report_terms: header.test_report_terms, special_instruction: header.special_instruction, notes: header.notes || undefined,
      lines: lines.map((line) => ({ item_id: line.item_id, logical_line_id: line.logical_line_id, metadata_json: line.metadata_json, description: line.description || undefined,
        qty_ordered: Number(line.qty_ordered), unit_cost: Number(line.unit_cost), uom: line.uom,
        expected_unit_count: line.expected_unit_count ? Number(line.expected_unit_count) : undefined,
        count_basis: line.expected_unit_count ? line.count_basis : undefined,
        width_mm: line.width_mm ? Number(line.width_mm) : undefined,
        width_tolerance_mm: line.width_tolerance_mm ? Number(line.width_tolerance_mm) : undefined,
        gsm: line.gsm ? Number(line.gsm) : undefined,
        plybond: line.plybond ? Number(line.plybond) : undefined, bulk: line.bulk ? Number(line.bulk) : undefined,
        cobb: line.cobb || undefined, incoming_qc_required: line.incoming_qc_required })),
    })
  }

  if (!activePlant || activePlant === "ALL") return <ProcurementShell eyebrow="Purchasing" title="Purchase order" description="Select the purchase order plant.">{null}</ProcurementShell>
  if (orderId && existingQuery.isLoading) return <p className="p-8 text-sm text-muted-foreground">Loading saved purchase order…</p>
  if (orderId && !existing) return <MessageBar tone="error">Purchase order could not load. Refresh before editing.</MessageBar>
  return (
    <ProcurementShell eyebrow={orderId ? `${existing.po_no} / new revision` : "Purchasing / create"} title={orderId ? "Revise purchase order" : "Create purchase order"}
      description="The server assigns the next RP-PM or OT number. Paper quantities stay in kg; an expected reel or coil count is optional planning information and never creates stock.">
      {error ? <MessageBar tone="error">{error}</MessageBar> : null}
      <form onSubmit={submit} className="space-y-5">
        {orderId ? <WorkPanel title="Reason for revision" description="Any vendor, item, quantity, rate, specification or term change creates a fresh draft requiring independent approval. The old approved document remains in history."><Field label="Change reason"><input required minLength={3} className={fieldClass} value={changeReason} onChange={(event) => setChangeReason(event.target.value)} /></Field></WorkPanel> : null}
        <WorkPanel title="Document and vendor" description="PO identity is automatic. Vendor and legal terms are snapshotted into this revision.">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Field label="Series"><select className={fieldClass} disabled={Boolean(orderId)} value={header.category} onChange={(e) => setHeader({ ...header, category: e.target.value })}><option value="RM_PM">RP-PM · Raw / packing</option><option value="OT">OT · Other</option></select></Field>
            <Field label="PO number" hint="server owned"><div className="flex h-11 items-center rounded-lg border border-dashed border-signal-cyan-line bg-signal-cyan-soft px-3 text-sm font-semibold text-signal-cyan-ink">{existing?.po_no || "Assigned after save"}</div></Field>
            <Field label="PO date"><input className={fieldClass} type="date" required value={header.po_date} onChange={(e) => setHeader({ ...header, po_date: e.target.value })} /></Field>
            <Field label="Expected date"><input className={fieldClass} type="date" required value={header.expected_date} onChange={(e) => setHeader({ ...header, expected_date: e.target.value })} /></Field>
            <Field label="Vendor"><select className={fieldClass} required value={header.supplier_id} onChange={(e) => { const vendor: any = vendors.find((row: any) => String(row.id) === e.target.value); setHeader({ ...header, supplier_id: e.target.value, supplier_contact: vendor?.contact_person || "", supplier_address: vendor?.address || "", supplier_gst_no: vendor?.gst_no || "" }) }}><option value="">Select actual vendor</option>{vendors.map((vendor: any) => <option key={vendor.id} value={vendor.id}>{vendor.supplier_code} · {vendor.name}</option>)}</select></Field>
            <Field label="Contact"><input className={fieldClass} value={header.supplier_contact} onChange={(e) => setHeader({ ...header, supplier_contact: e.target.value })} /></Field>
            <Field label="GST number"><input className={fieldClass} value={header.supplier_gst_no} onChange={(e) => setHeader({ ...header, supplier_gst_no: e.target.value.toUpperCase() })} /></Field>
            <Field label="Vendor address"><input className={fieldClass} value={header.supplier_address} onChange={(e) => setHeader({ ...header, supplier_address: e.target.value })} /></Field>
          </div>
        </WorkPanel>

        <WorkPanel title="Material lines" description="Use one line for each commercial rate/specification. Received quantities will be linked back to this stable line identity."
          action={<button type="button" className={secondaryButton} onClick={() => setLines((current) => [...current, emptyLine()])}><Plus className="h-4 w-4" /> Add line</button>}>
          <div className="space-y-4">{lines.map((line, index) => (
            <article key={line.key} className="rounded-xl border border-border bg-muted/60 p-4">
              <div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-semibold text-foreground">Line {index + 1}</h3><button type="button" aria-label={`Remove line ${index + 1}`} disabled={lines.length === 1 || Boolean(existing?.lines.find((row: any) => row.logical_line_id === line.logical_line_id)?.qty_received)} onClick={() => setLines((current) => current.filter((row) => row.key !== line.key))} className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-signal-rose-soft hover:text-signal-rose-ink disabled:opacity-30"><Trash2 className="h-4 w-4" /></button></div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
                <Field label="Material"><select className={fieldClass} required value={line.item_id} onChange={(e) => { const item = items.find((row: any) => String(row.id) === e.target.value); setLine(line.key, { item_id: e.target.value, description: item?.name || line.description, uom: item?.uom || "KG" }) }}><option value="">Select material</option>{items.map((item: any) => <option key={item.id} value={item.id}>{item.item_code} · {item.name}</option>)}</select></Field>
                <Field label="Description"><input className={fieldClass} value={line.description} onChange={(e) => setLine(line.key, { description: e.target.value })} /></Field>
                <Field label={`Quantity · ${line.uom}`}><input className={fieldClass} required min="0.001" step="0.001" type="number" value={line.qty_ordered} onChange={(e) => setLine(line.key, { qty_ordered: e.target.value })} /></Field>
                <Field label={`Rate / ${line.uom}`}><input className={fieldClass} required min="0" step="0.0001" type="number" value={line.unit_cost} onChange={(e) => setLine(line.key, { unit_cost: e.target.value })} /></Field>
                <Field label="Expected units" hint="optional"><input className={fieldClass} min="1" step="1" type="number" value={line.expected_unit_count} onChange={(e) => setLine(line.key, { expected_unit_count: e.target.value })} /></Field>
                <Field label="Count basis"><select className={fieldClass} disabled={!line.expected_unit_count} value={line.count_basis} onChange={(e) => setLine(line.key, { count_basis: e.target.value as LineDraft["count_basis"] })}><option value="ESTIMATED">Estimated</option><option value="CONTRACTUAL">Contractual</option></select></Field>
              </div>
              <details className="mt-3"><summary className="cursor-pointer text-sm font-medium text-signal-cyan-ink">Paper specification & incoming QC</summary><div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-7">
                <Field label="Width mm"><input className={fieldClass} min="0" step="0.01" type="number" value={line.width_mm} onChange={(e) => setLine(line.key, { width_mm: e.target.value })} /></Field>
                <Field label="Width tolerance ± mm"><input className={fieldClass} min="0" step="0.01" type="number" value={line.width_tolerance_mm} onChange={(e) => setLine(line.key, { width_tolerance_mm: e.target.value })} /></Field>
                <Field label="GSM"><input className={fieldClass} min="0" step="0.01" type="number" value={line.gsm} onChange={(e) => setLine(line.key, { gsm: e.target.value })} /></Field>
                <Field label="Ply bond"><input className={fieldClass} min="0" step="0.01" type="number" value={line.plybond} onChange={(e) => setLine(line.key, { plybond: e.target.value })} /></Field>
                <Field label="Bulk"><input className={fieldClass} min="0" step="0.001" type="number" value={line.bulk} onChange={(e) => setLine(line.key, { bulk: e.target.value })} /></Field>
                <Field label="COBB"><input className={fieldClass} value={line.cobb} onChange={(e) => setLine(line.key, { cobb: e.target.value })} /></Field>
                <div className="rounded-lg bg-card px-3 py-2"><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Line amount</p><p className="mt-2 font-semibold tabular-nums text-foreground">₹{(Number(line.qty_ordered || 0) * Number(line.unit_cost || 0)).toLocaleString("en-IN", { maximumFractionDigits: 2 })}</p></div>
              </div><label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={line.incoming_qc_required} onChange={(event) => setLine(line.key, { incoming_qc_required: event.target.checked })} /> Incoming QC required</label></details>
            </article>
          ))}</div>
        </WorkPanel>

        <WorkPanel title="Terms and authorization" description="These fields print on the saved PO and stay with every revision.">
          <div className="grid gap-4 md:grid-cols-2">
            {([['Payment terms','payment_terms'],['Freight terms','freight_terms'],['Tax terms','tax_terms'],['Delivery terms','delivery_terms'],['Test report terms','test_report_terms'],['Special instruction','special_instruction']] as const).map(([label, key]) => <Field key={key} label={label}><input className={fieldClass} value={header[key]} onChange={(e) => setHeader({ ...header, [key]: e.target.value })} /></Field>)}
            <div className="md:col-span-2"><Field label="Internal notes"><textarea className={areaClass} rows={3} value={header.notes} onChange={(e) => setHeader({ ...header, notes: e.target.value })} /></Field></div>
          </div>
        </WorkPanel>

        <section className="sticky bottom-4 z-10 flex flex-col gap-3 rounded-xl border border-border bg-card/95 p-4 shadow-xl backdrop-blur sm:flex-row sm:items-center sm:justify-between">
          <div><p className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">Draft total</p><p className="mt-1 text-lg font-semibold tabular-nums text-foreground">{lines.length} lines · {quantities} · ₹{totalValue.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</p></div>
          <button disabled={create.isPending} className={primaryButton}><Save className="h-4 w-4" />{create.isPending ? "Saving…" : orderId ? "Save revision for reapproval" : "Save PO draft"}</button>
        </section>
      </form>
    </ProcurementShell>
  )
}
