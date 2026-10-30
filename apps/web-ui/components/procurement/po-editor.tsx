"use client"

import { useAuth } from "@/context/AuthContext"
import { businessDate } from "@/lib/business-date"

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useMutation, useQuery } from "@tanstack/react-query"
import { Plus, Save, Trash2 } from "lucide-react"

import { ProcurementShell, Field, MessageBar, WorkPanel, areaClass, fieldClass, primaryButton, secondaryButton } from "@/components/procurement/procurement-shell"
import { useInventoryItems } from "@/hooks/use-inventory"
import { useVendors } from "@/hooks/use-master-data"
import { api, purchaseApi } from "@/lib/api"
import { vendorAddress } from "@/lib/party-formats"
import { cn } from "@/lib/utils"
import { unitWord } from "@/components/procurement/rm-calendar/format"

const today = () => businessDate()
// 44 px fields on a phone (36 px from the small breakpoint up, like the other desks).
const inputClass = cn(fieldClass, "max-sm:h-11")
/** "Rate / kg", "Rate / piece": plain lower-case units, never the stock code. */
const rateUnit = (uom: string) => (String(uom).toUpperCase() === "PCS" ? "piece" : unitWord(uom))
type LineDraft = { logical_line_id?: string; metadata_json?: Record<string, any>; uom: string; key: string; item_id: string; description: string; qty_ordered: string; unit_cost: string; width_mm: string; width_tolerance_mm: string; gsm: string; plybond: string; bulk: string; cobb: string; expected_unit_count: string; count_basis: "ESTIMATED" | "CONTRACTUAL"; delivery_date?: string }
const emptyLine = (): LineDraft => ({ uom: "KG", key: crypto.randomUUID(), item_id: "", description: "", qty_ordered: "", unit_cost: "", width_mm: "", width_tolerance_mm: "", gsm: "", plybond: "", bulk: "", cobb: "", expected_unit_count: "", count_basis: "ESTIMATED" })

// Vendor master details snapshotted on the PO with the GSTIN (client 2026-10-27); they print in the supplier block.
const SUPPLIER_DETAIL_KEYS = ["supplier_legal_name", "supplier_pan_no", "supplier_state", "supplier_state_code", "supplier_phone", "supplier_email", "supplier_msme_no"] as const
type SupplierDetails = Record<(typeof SUPPLIER_DETAIL_KEYS)[number], string>
const supplierDetails = (vendor: any): SupplierDetails => ({
  supplier_legal_name: vendor?.legal_name || "", supplier_pan_no: vendor?.pan_no || "", supplier_state: vendor?.state || "",
  supplier_state_code: vendor?.state_code || "", supplier_phone: [vendor?.contact_phone, vendor?.alt_phone].filter(Boolean).join(" / "),
  supplier_email: vendor?.contact_email || "", supplier_msme_no: vendor?.msme_no || "",
})
/** Header fields a vendor fills when chosen (the user may still edit contact, GSTIN and address). */
const fromVendor = (vendor: any) => ({
  supplier_contact: [vendor?.contact_name || vendor?.contact_person, vendor?.contact_phone].filter(Boolean).join(" · "),
  supplier_address: vendorAddress(vendor), supplier_gst_no: vendor?.gst_no || "", ...supplierDetails(vendor),
})

function message(error: any) {
  const detail = error?.response?.data?.detail
  return typeof detail === "string" ? detail : error?.message || "Purchase order could not be saved."
}

export default function PurchaseOrderEditor({ orderId }: { orderId?: string }) {
  const { activePlant } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [requisitionId, setRequisitionId] = useState(searchParams.get("requisition") || "")
  const requisitionsQuery = useQuery({ queryKey: ["purchase-requisitions", activePlant, "APPROVED"], enabled: Boolean(activePlant && activePlant !== "ALL"), queryFn: () => api.get("/api/purchase/requisitions", { params: { status: "APPROVED" } }) })
  const requisitions = requisitionsQuery.data?.data?.items || []
  const appliedRequisition = useRef("")
  const requestKey = useRef(crypto.randomUUID())
  const [changeReason, setChangeReason] = useState("")
  const existingQuery = useQuery({ queryKey: ["purchase-v2", "edit", orderId, activePlant], refetchOnWindowFocus: false, queryFn: () => purchaseApi.getOrder(orderId!), enabled: Boolean(activePlant && activePlant !== "ALL") && Boolean(orderId) })
  const existing = existingQuery.data?.data
  // A draft that was never approved or sent is not a revision: there is no approved document to
  // keep and nothing to re-approve (checker 2026-10-30, RP-PM/34 from the RM calendar).
  const historyQuery = useQuery({ queryKey: ["purchase-v2", "history", orderId, activePlant], refetchOnWindowFocus: false, queryFn: () => purchaseApi.getOrderHistory(orderId!), enabled: Boolean(activePlant && activePlant !== "ALL") && Boolean(orderId) })
  const everApproved = Boolean(existing && (existing.approved_at || existing.sent_at || existing.metadata_json?.send_history?.length
    || (historyQuery.data?.data?.items || []).some((revision: any) => revision.approved_at)))
  // Unknown history (it failed to load) keeps the safer revision wording.
  const draftOnly = Boolean(orderId && existing && existing.status === "DRAFT" && historyQuery.isSuccess && !everApproved)
  const vendorsQuery = useVendors()
  // The PO carries only the ordered quantity and rate (client 2026-10-26): no expected reel count,
  // tare or quality specification is typed here. Incoming QC checks each delivery against the
  // material standard; a revised older PO keeps whatever it had saved, unseen.
  const itemsQuery = useInventoryItems()
  const vendors = useMemo(() => (Array.isArray(vendorsQuery.data) ? vendorsQuery.data : []), [vendorsQuery.data])
  const items = useMemo(() => (Array.isArray(itemsQuery.data) ? itemsQuery.data.filter((item: any) => String(item.type) !== "FINISHED_GOOD") : []), [itemsQuery.data])
  const [header, setHeader] = useState({ category: "RM_PM", supplier_id: "", po_date: today(), expected_date: today(), supplier_contact: "", supplier_address: "", supplier_gst_no: "", ...supplierDetails(null), payment_terms: "60 days from invoice date.", freight_terms: "Freight included in landed rate.", tax_terms: "GST extra as applicable.", delivery_terms: "Delivery as per agreed schedule.", test_report_terms: "Attach PB/GSM/RCT/COBB test report with each delivery.", special_instruction: "FOR AMIGO INDUSTRIES UNIT-2", notes: "" })
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()])
  const [error, setError] = useState("")
  const selectedVendor = vendors.find((vendor: any) => String(vendor.id) === header.supplier_id)
  const quantities = Object.entries(lines.reduce((totals, line) => ({ ...totals, [line.uom]: (totals[line.uom] || 0) + Number(line.qty_ordered || 0) }), {} as Record<string, number>)).map(([uom, qty]) => `${qty.toLocaleString("en-IN")} ${unitWord(uom)}`).join(" + ")
  const totalValue = lines.reduce((sum, line) => sum + Number(line.qty_ordered || 0) * Number(line.unit_cost || 0), 0)

  const create = useMutation({ mutationFn: (data: any) => orderId ? purchaseApi.reviseOrder(orderId, { ...data, expected_version: existing.version, change_reason: draftOnly && changeReason.trim().length < 3 ? "Draft changed before approval" : changeReason }) : purchaseApi.createOrder(data), onSuccess: ({ data }) => router.push(`/purchase/${data.id}`), onError: (caught) => setError(message(caught)) })
  const setLine = (key: string, patch: Partial<LineDraft>) => setLines((current) => current.map((line) => line.key === key ? { ...line, ...patch } : line))

  useEffect(() => {
    if (!existing) return
    setHeader((current) => Object.fromEntries(Object.entries(current).map(([key, fallback]) => [key, existing[key] ?? existing.metadata_json?.[key] ?? fallback])) as typeof current)
    setLines(existing.lines.map((row: any) => ({ ...emptyLine(), ...Object.fromEntries(Object.keys(emptyLine()).filter((key) => key !== "key").map((key) => [key, row[key] == null ? "" : String(row[key])])), key: row.id, logical_line_id: row.logical_line_id, metadata_json: row.metadata_json, uom: row.uom, count_basis: row.count_basis || "ESTIMATED" })))
  }, [existing])

  // A revision of an older PO picks up vendor details (GSTIN, address, PAN, state) the master has but the saved revision lacks.
  const filledFromMaster = useRef(false)
  useEffect(() => {
    if (!existing || filledFromMaster.current || !header.supplier_id) return
    const vendor: any = vendors.find((row: any) => String(row.id) === header.supplier_id)
    if (!vendor) return
    filledFromMaster.current = true
    const master = fromVendor(vendor) as Record<string, string>
    setHeader((current) => ({ ...current, ...Object.fromEntries(Object.entries(master).filter(([key, value]) => value && !(current as Record<string, string>)[key])) }))
  }, [existing, vendors, header.supplier_id])

  useEffect(() => {
    if (!requisitionId) { appliedRequisition.current = ""; return }
    if (orderId || appliedRequisition.current === requisitionId) return
    const pr = requisitionsQuery.data?.data?.items?.find((row: any) => row.id === requisitionId)
    if (!pr) return
    appliedRequisition.current = requisitionId
    setHeader((current) => ({ ...current, category: "OT" }))
    setLines([{ ...emptyLine(), item_id: pr.item_id, description: pr.item_name, qty_ordered: String(pr.quantity), uom: pr.uom }])
  }, [requisitionId, requisitionsQuery.data, orderId])

  function submit(event: React.FormEvent) {
    event.preventDefault(); setError("")
    if (!selectedVendor || lines.some((line) => !line.item_id || Number(line.qty_ordered) <= 0 || Number(line.unit_cost) < 0)) {
      setError("Select a vendor and complete every material, quantity and rate before saving."); return
    }
    if (orderId && !draftOnly && changeReason.trim().length < 3) { setError("Explain the vendor change before saving a new revision."); return }
    create.mutate({
      requisition_id: requisitionId || undefined,
      request_id: requestKey.current, category: header.category, po_date: header.po_date,
      supplier_id: selectedVendor.id, supplier_name: selectedVendor.name, expected_date: header.expected_date,
      supplier_contact: header.supplier_contact || undefined, supplier_address: header.supplier_address || undefined,
      supplier_gst_no: header.supplier_gst_no || undefined, payment_terms: header.payment_terms,
      metadata_json: Object.fromEntries(SUPPLIER_DETAIL_KEYS.filter((key) => header[key]).map((key) => [key, header[key]])),
      freight_terms: header.freight_terms, tax_terms: header.tax_terms, delivery_terms: header.delivery_terms,
      test_report_terms: header.test_report_terms, special_instruction: header.special_instruction, notes: header.notes || undefined,
      // A line's own arrival date becomes its dated delivery row (spec 3); without one the PO date is used.
      lines: lines.map((line) => ({ item_id: line.item_id, logical_line_id: line.logical_line_id,
        metadata_json: line.delivery_date ? { ...(line.metadata_json || {}), delivery_date: line.delivery_date } : line.metadata_json, description: line.description || undefined,
        qty_ordered: Number(line.qty_ordered), unit_cost: Number(line.unit_cost), uom: line.uom,
        expected_unit_count: line.expected_unit_count ? Number(line.expected_unit_count) : undefined,
        count_basis: line.expected_unit_count ? line.count_basis : undefined,
        width_mm: line.width_mm ? Number(line.width_mm) : undefined,
        width_tolerance_mm: line.width_tolerance_mm ? Number(line.width_tolerance_mm) : undefined,
        gsm: line.gsm ? Number(line.gsm) : undefined,
        plybond: line.plybond ? Number(line.plybond) : undefined, bulk: line.bulk ? Number(line.bulk) : undefined,
        // No QC tick (client 2026-10-30): the server marks every line for incoming QC.
        cobb: line.cobb || undefined })),
    })
  }

  if (!activePlant || activePlant === "ALL") return <ProcurementShell eyebrow="Purchasing" title="Purchase order" description="Select the purchase order plant.">{null}</ProcurementShell>
  if (orderId && (existingQuery.isLoading || historyQuery.isLoading)) return <p className="p-8 text-sm text-muted-foreground">Loading saved purchase order…</p>
  if (orderId && !existing) return <MessageBar tone="error">Purchase order could not load. Refresh before editing.</MessageBar>
  return (
    <ProcurementShell eyebrow={orderId ? `${existing.po_no} / ${draftOnly ? "draft" : "new revision"}` : "Purchasing / create"} title={draftOnly ? "Edit draft purchase order" : orderId ? "Revise purchase order" : "Create purchase order"}
      description="The server assigns the next RP-PM or OT number. Enter the ordered quantity and rate for each material; paper is ordered in kg. Quality is checked at inward against the material standard.">
      {error ? <MessageBar tone="error">{error}</MessageBar> : null}
      <form onSubmit={submit} className="space-y-5">
        {!orderId ? <WorkPanel title="Approved requisition" description="Required for tools, spares and other purchases. Select the approved request to fill its material and quantity."><Field label="PR reference"><select className={inputClass} value={requisitionId} onChange={(event) => setRequisitionId(event.target.value)}><option value="">No requisition · RM / PM purchase</option>{requisitions.map((pr: any) => <option key={pr.id} value={pr.id}>{pr.pr_no} · {pr.item_name} · {Number(pr.quantity).toLocaleString("en-IN")} {unitWord(pr.uom)}</option>)}</select></Field>{requisitionsQuery.isError ? <MessageBar tone="error">Approved requisitions could not load. Retry before creating an OT purchase.</MessageBar> : null}</WorkPanel> : null}
        {draftOnly && existing.source === "SCHEDULE" ? <MessageBar tone="info">Scheduled by the Owner. A change to a quantity, date, vendor or rate needs the Owner&rsquo;s approval before it is sent; a change the Owner makes counts as that approval.</MessageBar> : null}
        {orderId && !draftOnly ? <WorkPanel title="Reason for revision" description="Any vendor, item, quantity, rate, specification or term change creates a fresh draft requiring independent approval. The old approved document remains in history."><Field label="Change reason"><input required minLength={3} className={inputClass} value={changeReason} onChange={(event) => setChangeReason(event.target.value)} /></Field></WorkPanel> : null}
        <WorkPanel title="Document and vendor" description={`PO identity is automatic. Vendor and legal terms are snapshotted into this ${draftOnly ? "draft" : "revision"}.`}>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Field label="Series"><select className={inputClass} disabled={Boolean(orderId)} value={header.category} onChange={(e) => setHeader({ ...header, category: e.target.value })}><option value="RM_PM">RP-PM · Raw / packing</option><option value="OT">OT · Other</option></select></Field>
            <Field label="PO number" hint="server owned"><div className="flex h-11 items-center rounded-lg border border-dashed border-signal-cyan-line bg-signal-cyan-soft px-3 text-sm font-semibold text-signal-cyan-ink">{existing?.po_no || "Assigned after save"}</div></Field>
            <Field label="PO date"><input className={inputClass} type="date" required value={header.po_date} onChange={(e) => setHeader({ ...header, po_date: e.target.value })} /></Field>
            <Field label="Expected date"><input className={inputClass} type="date" required value={header.expected_date} onChange={(e) => setHeader({ ...header, expected_date: e.target.value })} /></Field>
            <Field label="Vendor"><select className={inputClass} required value={header.supplier_id} onChange={(e) => { const vendor: any = vendors.find((row: any) => String(row.id) === e.target.value); setHeader({ ...header, supplier_id: e.target.value, ...fromVendor(vendor), ...(vendor?.payment_terms_days != null ? { payment_terms: `${vendor.payment_terms_days} days from invoice date.` } : {}) }) }}><option value="">Select actual vendor</option>{vendors.map((vendor: any) => <option key={vendor.id} value={vendor.id}>{vendor.supplier_code} · {vendor.name}</option>)}</select></Field>
            <Field label="Contact"><input className={inputClass} value={header.supplier_contact} onChange={(e) => setHeader({ ...header, supplier_contact: e.target.value })} /></Field>
            <Field label="GSTIN"><input className={cn(inputClass, "font-mono")} data-testid="po-supplier-gstin" value={header.supplier_gst_no} onChange={(e) => setHeader({ ...header, supplier_gst_no: e.target.value.toUpperCase() })} placeholder="Not in vendor master" /></Field>
            <Field label="Vendor address"><input className={inputClass} value={header.supplier_address} onChange={(e) => setHeader({ ...header, supplier_address: e.target.value })} /></Field>
          </div>
          {header.supplier_id ? <p className="mt-3 text-xs text-muted-foreground" data-testid="po-supplier-details">From the vendor master: {[header.supplier_legal_name && `legal name ${header.supplier_legal_name}`, header.supplier_pan_no && `PAN ${header.supplier_pan_no}`, header.supplier_state && `${header.supplier_state}${header.supplier_state_code ? ` (${header.supplier_state_code})` : ""}`, header.supplier_msme_no && `MSME ${header.supplier_msme_no}`, header.supplier_email].filter(Boolean).join(" · ") || "no GSTIN, PAN or state saved yet. Add them in Masters › Vendors."}</p> : null}
        </WorkPanel>

        <WorkPanel title="Material lines" description="One line for each material and rate. Goods inward receives against the ordered quantity of each line."
          action={<button type="button" className={secondaryButton} onClick={() => setLines((current) => [...current, emptyLine()])}><Plus className="h-4 w-4" /> Add line</button>}>
          {itemsQuery.isError ? <MessageBar tone="error">Materials could not be loaded: {String((itemsQuery.error as any)?.response?.data?.detail || (itemsQuery.error as any)?.message || "server error")}. Retry by reloading the page.</MessageBar> : null}
          <div className="space-y-4">{lines.map((line, index) => (
            <article key={line.key} className="rounded-xl border border-border bg-muted/60 p-4">
              <div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-semibold text-foreground">Line {index + 1}</h3><button type="button" aria-label={`Remove line ${index + 1}`} disabled={lines.length === 1 || Boolean(existing?.lines.find((row: any) => row.logical_line_id === line.logical_line_id)?.qty_received)} onClick={() => setLines((current) => current.filter((row) => row.key !== line.key))} className="flex h-11 w-11 items-center justify-center rounded-lg sm:h-10 sm:w-10 text-muted-foreground hover:bg-signal-rose-soft hover:text-signal-rose-ink disabled:opacity-30"><Trash2 className="h-4 w-4" /></button></div>
              <div className={`grid gap-3 md:grid-cols-2 ${orderId ? "xl:grid-cols-5" : "xl:grid-cols-6"}`}>
                <Field label="Material"><select className={inputClass} required value={line.item_id} onChange={(e) => { const item = items.find((row: any) => String(row.id) === e.target.value); setLine(line.key, { item_id: e.target.value, description: item?.name || line.description, uom: item?.uom || "KG" }) }}><option value="">{itemsQuery.isLoading ? "Loading materials…" : items.length ? "Select material" : "No materials yet — add them in Masters"}</option>{items.map((item: any) => <option key={item.id} value={item.id}>{item.item_code} · {item.name}</option>)}</select></Field>
                <Field label="Description"><input className={inputClass} value={line.description} onChange={(e) => setLine(line.key, { description: e.target.value })} /></Field>
                <Field label={`Ordered quantity · ${unitWord(line.uom)}`}><input aria-label={`Line ${index + 1} ordered quantity`} className={inputClass} required min={line.uom === "PCS" ? "1" : "0.001"} step={line.uom === "PCS" ? "1" : "0.001"} type="number" value={line.qty_ordered} onChange={(e) => setLine(line.key, { qty_ordered: e.target.value })} /></Field>
                <Field label={`Rate / ${rateUnit(line.uom)}`}><input className={inputClass} required min="0" step="0.0001" type="number" value={line.unit_cost} onChange={(e) => setLine(line.key, { unit_cost: e.target.value })} /></Field>
                {!orderId ? <Field label="Arrives on" hint="optional"><input aria-label={`Line ${index + 1} arrives on`} className={inputClass} type="date" min={header.po_date} value={line.delivery_date || ""} placeholder={header.expected_date} onChange={(e) => setLine(line.key, { delivery_date: e.target.value })} /></Field> : null}
                <div className="rounded-lg bg-card px-3 py-2"><p className="text-[11.5px] font-semibold text-muted-foreground">Line amount</p><p className="mt-2 font-semibold tabular-nums text-foreground">₹{(Number(line.qty_ordered || 0) * Number(line.unit_cost || 0)).toLocaleString("en-IN", { maximumFractionDigits: 2 })}</p></div>
              </div>
            </article>
          ))}</div>
        </WorkPanel>

        <WorkPanel title="Terms and authorization" description="These fields print on the saved PO and stay with every revision.">
          <div className="grid gap-4 md:grid-cols-2">
            {([['Payment terms','payment_terms'],['Freight terms','freight_terms'],['Tax terms','tax_terms'],['Delivery terms','delivery_terms'],['Test report terms','test_report_terms'],['Special instruction','special_instruction']] as const).map(([label, key]) => <Field key={key} label={label}><input className={inputClass} value={header[key]} onChange={(e) => setHeader({ ...header, [key]: e.target.value })} /></Field>)}
            <div className="md:col-span-2"><Field label="Internal notes"><textarea className={areaClass} rows={3} value={header.notes} onChange={(e) => setHeader({ ...header, notes: e.target.value })} /></Field></div>
          </div>
        </WorkPanel>

        <section className="sticky bottom-4 z-10 flex flex-col gap-3 rounded-xl border border-border bg-card/95 p-4 shadow-xl backdrop-blur sm:flex-row sm:items-center sm:justify-between">
          <div><p className="text-[12px] font-semibold text-muted-foreground">Draft total</p><p className="mt-1 text-lg font-semibold tabular-nums text-foreground">{lines.length} {lines.length === 1 ? "line" : "lines"} · {quantities} · ₹{totalValue.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</p></div>
          <button disabled={create.isPending} className={primaryButton}><Save className="h-4 w-4" />{create.isPending ? "Saving…" : draftOnly ? "Save draft" : orderId ? "Save revision for reapproval" : "Save PO draft"}</button>
        </section>
      </form>
    </ProcurementShell>
  )
}
