"use client"

import Link from "next/link"
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import type { KeyboardEvent } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus, Trash2, ArrowRight, PackageCheck } from "lucide-react"
import { useSearchParams } from "next/navigation"
import { Field, MessageBar, ProcurementShell, WorkPanel, fieldClass, primaryButton, secondaryButton } from "@/components/procurement/procurement-shell"
import { LabelPrintControls } from "@/components/procurement/label-print-controls"
import { LotLabels } from "@/components/procurement/lot-labels"
import { RoleGate } from "@/components/workspace/role-gate"
import { useAuth } from "@/context/AuthContext"
import { useInventoryItems, useInventoryLocations } from "@/hooks/use-inventory"
import { useVendors } from "@/hooks/use-master-data"
import { purchaseApi } from "@/lib/api"
import { businessDate } from "@/lib/business-date"
import { dayText, plural, unitWord } from "@/lib/stock-format"
import type { ReceivableLine } from "@/lib/procurement-types"

// Net weight only (client 2026-10-26): no gross / tare and no vendor batch at inward.
type Lot = { key: string; source_reel_no: string; net_weight_kg: string; width_mm: string; width_unit: "MM" | "CM"; physical_form: "REEL" | "COIL" }
type Line = { key: string; item_id: string; po_line_id: string; quantity: string; invoice_quantity: string; invoice_rate: string; batch_no: string; lots: Lot[]; location_id: string }
/** The reel / coil grid opens with 10 empty rows; empty rows are ignored on save. */
const LOT_ROWS = 10
const newLot = (previous?: Lot): Lot => ({ key: crypto.randomUUID(), source_reel_no: "", net_weight_kg: "", width_mm: previous?.width_mm || "", width_unit: previous?.width_unit || "MM", physical_form: previous?.physical_form || "REEL" })
const blankLots = (count: number, previous?: Lot): Lot[] => { const out: Lot[] = []; for (let i = 0; i < count; i += 1) out.push(newLot(out.at(-1) || previous)); return out }
const lotFilled = (lot: Lot) => Boolean(lot.source_reel_no.trim() || String(lot.net_weight_kg).trim())
const filledLots = (line: Line) => line.lots.filter(lotFilled)
const newLine = (): Line => ({ key: crypto.randomUUID(), item_id: "", po_line_id: "", quantity: "", invoice_quantity: "", invoice_rate: "", batch_no: "", lots: blankLots(LOT_ROWS), location_id: "" })
const errorText = (error: any) => typeof error?.response?.data?.detail === "string" ? error.response.data.detail : error.message || "Review the form and try again."

/** What happens next and who acts (client 2026-10-18: "approval ke liye kiske pass jayega").
 * Incoming QC is the only gate for issue: the invoice and any rate case go to Accounts and never hold the lots. */
const QC_DECIDES = "Incoming QC decides when the lots can be issued."
function commercialNext(status: string | null | undefined, rateCases = 0): string {
  const rateCase = rateCases > 0 ? ` The challan rate differs from the PO, so ${rateCases === 1 ? "a rate case is" : `${rateCases} rate cases are`} open for the plant head or Accounts in Purchase › Invoice differences. They have been notified.` : ""
  switch (String(status || "").toUpperCase()) {
    case "CLEAR": return `Rates match the PO. ${QC_DECIDES}`
    case "INVOICE_PENDING": return `${QC_DECIDES} The pending invoice does not hold them: Store attaches it in Purchase › GRN register when it arrives.${rateCase}`
    case "RATE_REVIEW":
    case "REVIEW_REQUIRED": return `The invoice rate or quantity differs from the PO. The plant head or Accounts decides it in Purchase › Invoice differences (not the person who made this GRN); they have been notified. ${QC_DECIDES}`
    case "MANUAL_REVIEW": return `Manual GRN without a PO: the plant head or Accounts approves it in Purchase › GRN register (not the person who made it); they have been notified. ${QC_DECIDES}`
    default: return `The plant head or Accounts settles the commercial side. ${QC_DECIDES}`
  }
}

/** The receipt's commercial state in plain words, for the validation result. */
function commercialWord(status: string | null | undefined): string {
  switch (String(status || "").toUpperCase()) {
    case "CLEAR": return "rates match the PO"
    case "INVOICE_PENDING": return "invoice to follow"
    case "RATE_REVIEW":
    case "REVIEW_REQUIRED": return "differs from the PO · goes to Accounts"
    case "MANUAL_REVIEW": return "manual GRN · goes to Accounts"
    default: return ""
  }
}

/** "1,234.5 kg", "40 pcs": en-IN number with the unit in words, never "KG". */
function unitQty(value: unknown, uom: string | null | undefined): string {
  return `${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 3 })} ${unitWord(uom || "KG")}`
}

/** Fields are 44 px tall on a phone (thumb targets), compact on a desk. */
const phoneField = `${fieldClass} max-sm:h-11`

function PurchaseInwardPage() {
  const { activePlant, user, activeRole } = useAuth(); const client = useQueryClient()
  // Incoming QC opens for these roles only; a GRN-only desk sees the QC state on the saved receipt instead.
  const canOpenQc = [user?.role, activeRole, ...(user?.roles || [])].some((role) => ["QC", "InwardQC", "Store", "PlantManager", "Owner", "Admin"].includes(String(role || "")))
  // Store and the plant head see the lot read-only there (role matrix "view"), so their button says View.
  const canEnterQc = [user?.role, activeRole, ...(user?.roles || [])].some((role) => ["QC", "InwardQC", "Owner", "Admin"].includes(String(role || "")))
  const vendorsQuery = useVendors(); const itemsQuery = useInventoryItems(); const locationsQuery = useInventoryLocations()
  // Every GRN line says where the stock is put (client 2026-10-28): the plant's RM store unless the store picks a rack.
  const putIn: any[] = (Array.isArray(locationsQuery.data) ? locationsQuery.data : []).filter((row: any) => (!activePlant || activePlant === "ALL" || String(row.plant_id) === String(activePlant)) && ["STORAGE", "QC"].includes(String(row.purpose || "STORAGE").toUpperCase()))
  const receivingId = String((putIn.find((row: any) => row.is_receiving_default) || putIn[0] || {}).id || "")
  const receivingRow: any = putIn.find((row: any) => row.is_receiving_default)
  const receivingName = receivingRow ? String(receivingRow.name || "").trim() || String(receivingRow.code || "") : ""
  const lineLocation = (line: Line) => line.location_id || receivingId
  const vendors: any[] = Array.isArray(vendorsQuery.data) ? vendorsQuery.data : []
  const items: any[] = Array.isArray(itemsQuery.data) ? itemsQuery.data.filter((item: any) => item.type !== "FINISHED_GOOD") : []
  const receivable = useQuery({ queryKey: ["purchase-v2", "receivable", activePlant], enabled: Boolean(activePlant && activePlant !== "ALL"), queryFn: () => purchaseApi.getReceivableLines() })
  const available: ReceivableLine[] = receivable.data?.data?.items || []
  const searchParams = useSearchParams()
  const [mode, setMode] = useState<"PO" | "MANUAL">("PO")
  const [vendorId, setVendorId] = useState(""); const [poId, setPoId] = useState("")
  // Opened from a PO ("Receive goods"): preselect its vendor, PO and, when given, the material line.
  // Until the PO lines have loaded and filled the form, the form is locked, so nothing typed is overwritten.
  const prefill = useRef(false)
  const [prefillDone, setPrefillDone] = useState(false)
  const prefillPending = Boolean(searchParams.get("po")) && !prefillDone && !receivable.isError && Boolean(activePlant && activePlant !== "ALL")
  useEffect(() => {
    if (prefill.current || !receivable.isSuccess) return
    const wantedPo = searchParams.get("po"); const wantedLine = searchParams.get("line")
    if (!wantedPo) return
    const row = available.find((item) => item.po_id === wantedPo)
    prefill.current = true; setPrefillDone(true)
    if (!row) { setNotice({ tone: "info", text: "That purchase order has nothing open to receive (fully received, not approved yet, or closed)." }); return }
    setMode("PO"); setVendorId(row.supplier_id); setPoId(row.po_id)
    // Same as choosing the line in the select: the approved PO rate is the starting rate, editable.
    const wanted = wantedLine ? available.find((item) => item.po_id === wantedPo && item.po_line_id === wantedLine) : undefined
    setLines([{ ...newLine(), po_line_id: wanted ? wanted.po_line_id : "", item_id: wanted?.item_id || "", invoice_rate: wanted?.approved_rate != null ? String(wanted.approved_rate) : "" }])
    setNotice({ tone: "info", text: `Receiving against ${row.po_no} · ${row.supplier_name}. Vendor and PO are filled from the purchase order.` })
  }, [available, receivable.isSuccess, searchParams])
  const [lines, setLines] = useState<Line[]>([newLine()])
  const [invoice, setInvoice] = useState({ challan_no: "", invoice_no: "", invoice_date: businessDate(), pending: false, reason: "" })
  const [overReason, setOverReason] = useState("")
  const [notice, setNotice] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null)
  const [preview, setPreview] = useState<any>(null); const [reviewedPayload, setReviewedPayload] = useState<any>(null); const [posted, setPosted] = useState<any>(null)
  const [paste, setPaste] = useState<Record<string, string>>({})
  const pendingLotFocus = useRef<string | null>(null)
  useLayoutEffect(() => {
    if (pendingLotFocus.current) {
      document.getElementById(`vendor-lot-${pendingLotFocus.current}`)?.focus()
      pendingLotFocus.current = null
    }
  }, [lines])
  const request = useRef<{ key: string; fingerprint: string } | null>(null)
  useEffect(() => { setPreview(null); setReviewedPayload(null) }, [mode, vendorId, poId, lines, invoice, overReason])
  const vendor = vendors.find((row) => String(row.id) === vendorId)
  const poOptions = Array.from(new Map(available.filter((row) => row.supplier_id === vendorId).map((row) => [row.po_id, row])).values())
  const poLines = available.filter((row) => row.po_id === poId)
  const material = (line: Line) => mode === "PO" ? poLines.find((row) => row.po_line_id === line.po_line_id) : items.find((row) => String(row.id) === line.item_id)
  const isReel = (line: Line) => material(line)?.tracking_mode === "REEL"
  const quantity = (line: Line) => isReel(line) ? filledLots(line).reduce((sum, lot) => sum + Number(lot.net_weight_kg || 0), 0) : Number(line.quantity || 0)
  const total = lines.reduce((sum, line) => sum + quantity(line), 0)
  const quantitySummary = Object.entries(lines.reduce((totals, line) => { const uom = material(line)?.uom || "KG"; totals[uom] = (totals[uom] || 0) + quantity(line); return totals }, {} as Record<string, number>)).map(([uom, qty]) => unitQty(qty, uom)).join(" + ")
  const lotCount = lines.reduce((sum, line) => sum + (isReel(line) ? filledLots(line).length : 0), 0)
  const totalValue = lines.reduce((sum, line) => sum + quantity(line) * Number(line.invoice_rate || 0), 0)
  const updateLine = (key: string, patch: Partial<Line>) => { setLines((current) => current.map((line) => line.key === key ? { ...line, ...patch } : line)); setPreview(null) }
  const reset = () => { setLines([newLine()]); setPreview(null); setPosted(null); setOverReason(""); request.current = null }
  const updateLot = (line: Line, key: string, patch: Partial<Lot>) => {
    setLines((current) => current.map((row) => row.key === line.key ? { ...row, lots: row.lots.map((lot) => lot.key === key ? { ...lot, ...patch } : lot) } : row))
    setPreview(null)
  }
  function addLot(line: Line, count = 1) {
    const added = blankLots(count, line.lots.at(-1))
    pendingLotFocus.current = added[0].key
    setLines((current) => current.map((row) => row.key === line.key ? { ...row, lots: [...row.lots, ...added] } : row))
    setPreview(null)
  }
  function fastEntry(event: KeyboardEvent<HTMLTableSectionElement>, line: Line) {
    if (event.key !== "Enter" || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || !(event.target instanceof HTMLInputElement)) return
    event.preventDefault()
    const fields = Array.from(event.currentTarget.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input, select"))
    const index = fields.indexOf(event.target)
    if (index < fields.length - 1) fields[index + 1].focus(); else addLot(line)
  }
  function pasteLots(line: Line) {
    const parsed = (paste[line.key] || "").split(/\r?\n/).filter((row) => row.trim()).map((row) => {
      const [source_reel_no, net_weight_kg, width_mm, form = "REEL"] = row.split(/\t|,/).map((value) => value.trim())
      return { ...newLot(), source_reel_no, net_weight_kg, width_mm, physical_form: (form || "REEL").toUpperCase() as Lot["physical_form"] }
    })
    if (!parsed.length || parsed.some((lot) => !lot.source_reel_no || !Number.isFinite(Number(lot.net_weight_kg)) || Number(lot.net_weight_kg) <= 0 || Number(lot.width_mm) <= 0 || !["REEL", "COIL"].includes(lot.physical_form))) {
      setNotice({ tone: "error", text: "Every pasted row needs vendor reel number, net kg, width mm and REEL or COIL." }); return
    }
    const kept = [...filledLots(line), ...parsed]
    updateLine(line.key, { lots: kept.length < LOT_ROWS ? [...kept, ...blankLots(LOT_ROWS - kept.length, kept.at(-1))] : kept }); setPaste({ ...paste, [line.key]: "" })
  }
  function payload() {
    if (!vendorId || !vendor || (mode === "PO" && !poId)) throw new Error("Select vendor and an approved PO, or choose Manual GRN.")
    if (mode === "MANUAL" && invoice.reason.trim().length < 3) throw new Error("Explain why this material is received without a PO.")
    if (!invoice.challan_no.trim()) throw new Error("Enter the supplier challan number.")
    if (!invoice.pending && (!invoice.invoice_no.trim() || !invoice.invoice_date)) throw new Error("Enter invoice number and date, or mark invoice pending.")
    if (exceedsPo && overReason.trim().length < 3) throw new Error("This receipt is more than the PO still has open. Write the reason for receiving more than the PO.")
    const seen = new Set<string>()
    const receivedLines = lines.map((line, index) => {
      if (!material(line) || quantity(line) <= 0) throw new Error(`Material ${index + 1}: select material and enter the received quantity.`)
      if (!invoice.pending && (line.invoice_rate === "" || Number(line.invoice_rate) < 0)) throw new Error(`Material ${index + 1}: enter the invoice rate.`)
      if (invoice.pending && line.invoice_rate !== "" && !(Number(line.invoice_rate) >= 0)) throw new Error(`Material ${index + 1}: the rate must be a number of 0 or more, or left empty until the invoice comes.`)
      if (isReel(line)) filledLots(line).forEach((lot) => {
        const identity = lot.source_reel_no.trim().toUpperCase()
        if (!identity || seen.has(identity) || Number(lot.net_weight_kg) <= 0 || Number(lot.width_mm) <= 0) throw new Error(`Material ${index + 1}: each filled row needs its own vendor reel number, net kg and width.`)
        seen.add(identity)
      })
      if (putIn.length && !lineLocation(line)) throw new Error(`Material ${index + 1}: choose where it is put (the RM store or a rack).`)
      return {
        ...(mode === "PO" ? { po_line_id: line.po_line_id } : { item_id: line.item_id, incoming_qc_required: true }),
        location_id: lineLocation(line) || undefined,
        quantity: isReel(line) ? undefined : Number(line.quantity), invoice_quantity: invoice.pending ? undefined : Number(line.invoice_quantity || quantity(line)),
        // Invoice pending: the rate typed from the challan still goes with the GRN (client 2026-10-30).
        invoice_rate: invoice.pending && line.invoice_rate === "" ? undefined : Number(line.invoice_rate), batch_no: isReel(line) ? undefined : line.batch_no || undefined,
        lots: isReel(line) ? filledLots(line).map(({ key, width_unit, ...lot }) => ({ ...lot, source_reel_no: lot.source_reel_no.trim(), net_weight_kg: Number(lot.net_weight_kg), width_mm: Number(lot.width_mm) * (width_unit === "CM" ? 10 : 1) })) : [],
      }
    })
    const body = { ...(mode === "PO" ? { purchase_order_id: poId } : { supplier_id: vendorId, supplier_name: vendor.name, reason: invoice.reason }), received_date: businessDate(), supplier_challan_no: invoice.challan_no.trim(), invoice_pending: invoice.pending, invoice_no: invoice.pending ? undefined : invoice.invoice_no, invoice_date: invoice.pending ? undefined : invoice.invoice_date, currency: "INR", ...(mode === "PO" && exceedsPo ? { over_receipt_reason: overReason.trim() } : {}), lines: receivedLines }
    const fingerprint = JSON.stringify(body)
    if (!request.current || request.current.fingerprint !== fingerprint) request.current = { key: crypto.randomUUID(), fingerprint }
    return { ...body, request_id: request.current.key }
  }
  const validate = useMutation({ mutationFn: (body: any) => mode === "PO" ? purchaseApi.previewReceipt(body) : purchaseApi.previewManualReceipt(body), onSuccess: ({ data }, body) => { setPreview(data); setReviewedPayload(body); setNotice(null) }, onError: (error) => setNotice({ tone: "error", text: errorText(error) }) })
  const post = useMutation({ mutationFn: () => { if (!reviewedPayload || JSON.stringify(payload()) !== JSON.stringify(reviewedPayload)) throw new Error("Receipt details changed. Validate them again before posting."); return mode === "PO" ? purchaseApi.createReceipt(reviewedPayload) : purchaseApi.createManualReceipt(reviewedPayload) }, onSuccess: ({ data }) => { setPosted(data); setNotice({ tone: data.warnings?.length ? "info" : "success", text: `Inward ${data.grn_no} saved (challan ${data.supplier_challan_no || "—"}). ${plural(Number(data.lot_count || 0), "lot")} recorded. ${commercialNext(data.commercial_status, Array.isArray(data.rate_review_cases) ? data.rate_review_cases.length : 0)}${data.warnings?.length ? ` Note: ${data.warnings.join(" ")}` : ""}` }); client.invalidateQueries({ queryKey: ["purchase-v2"] }) }, onError: (error) => setNotice({ tone: "error", text: errorText(error) }) })
  const busy = post.isPending || validate.isPending
  const exceedsPo = mode === "PO" && lines.some((line) => { const row: any = material(line); return row && quantity(line) > Number(row.open_qty || 0) + 1e-9 })

  return <RoleGate allow={["Store", "PlantManager", "GRN"]}><ProcurementShell eyebrow="Stores / goods inward" title="Receive materials" description="Choose the vendor and receipt source, then enter each material and its actual weighed reels or coils." actions={<Link className={secondaryButton} href="/purchase/receipts">GRN register <ArrowRight className="h-4 w-4" /></Link>}>
    {notice ? <MessageBar tone={notice.tone}>{notice.text}</MessageBar> : null}
    {receivable.isError || vendorsQuery.isError || itemsQuery.isError ? <MessageBar tone="error">Receipt masters could not load. Refresh before entering stock.</MessageBar> : null}
    {posted ? <><WorkPanel title="Receipt saved" description="Every physical unit has its own permanent AT identity. Open the register for approvals, invoice attachment, QC and later reprints." action={<button className={primaryButton} onClick={() => { reset(); setInvoice({ challan_no: "", invoice_no: "", invoice_date: businessDate(), pending: false, reason: "" }) }}>Start next receipt</button>}><div className="flex flex-wrap gap-3"><Link className={secondaryButton} href={`/purchase/receipts/${posted.id}`}>Open saved receipt</Link>{(() => { const held = !canOpenQc ? null : (posted.lots || []).find((lot: any) => ["QC_HOLD", "BLOCKED"].includes(String(lot.stock_status || "").toUpperCase())); return held ? <Link data-testid="inward-posted-inspect" className={secondaryButton} href={`/quality/incoming?lot=${held.entity_type || "REEL"}:${held.id}&from=${encodeURIComponent(`/purchase/receipts/${posted.id}`)}`}>{canEnterQc ? "Inspect in incoming QC" : "View in incoming QC"}</Link> : null })()}{posted.lot_count > 0 ? <LabelPrintControls lots={posted.lots || posted.created_lots || []} /> : null}</div></WorkPanel><LotLabels lots={posted.lots || posted.created_lots || []} /></> : <>
    {prefillPending ? <MessageBar tone="info">Loading the purchase order lines… the form opens filled in a moment.</MessageBar> : null}
    <fieldset disabled={busy || prefillPending} aria-busy={prefillPending || undefined} className="contents">
    <WorkPanel title="Vendor & receipt source">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4"><Field label="Receipt source"><select className={phoneField} value={mode} onChange={(event) => { setMode(event.target.value as typeof mode); reset() }}><option value="PO">Against approved system PO</option><option value="MANUAL">Manual GRN · without PO</option></select></Field><Field label="Vendor"><select className={phoneField} value={vendorId} onChange={(event) => { setVendorId(event.target.value); setPoId(""); reset() }}><option value="">Select vendor</option>{vendors.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></Field>{mode === "PO" ? <Field label="Approved purchase order"><select className={phoneField} value={poId} disabled={!vendorId} onChange={(event) => { setPoId(event.target.value); reset() }}><option value="">Select approved PO</option>{poOptions.map((row) => <option key={row.po_id} value={row.po_id}>{row.po_no} · revision {row.revision_no}</option>)}</select></Field> : <Field label="Reason for no PO"><input className={phoneField} value={invoice.reason} onChange={(event) => setInvoice({ ...invoice, reason: event.target.value })} placeholder="e.g. approved urgent local purchase" /></Field>}<Field label="Inward date · automatic"><input className={phoneField} disabled value={dayText(businessDate())} /></Field></div>
      {vendor ? <p data-testid="inward-vendor-details" className="mt-3 flex flex-wrap gap-x-4 gap-y-1 rounded-lg border border-border bg-muted/60 px-3 py-2 text-[12.5px] text-muted-foreground"><span>GSTIN <strong className="font-mono text-foreground">{vendor.gst_no || "not in vendor master"}</strong></span>{vendor.city || vendor.state ? <span>{[vendor.city, vendor.state].filter(Boolean).join(", ")}{vendor.pin_code ? ` - ${vendor.pin_code}` : ""}</span> : null}{vendor.contact_name || vendor.contact_phone ? <span>Contact {[vendor.contact_name, vendor.contact_phone].filter(Boolean).join(" · ")}</span> : null}</p> : null}
      <p className="mt-3 text-[12.5px] leading-5 text-muted-foreground"><strong className="text-foreground">Net weight only:</strong> enter the net kg of each reel or coil (paper alone). Stock, the PO balance and the invoice all go by net kg. <strong className="text-foreground">Inward number</strong> is given on save: P/26/001 for paper, A/26/001 for adhesive, IN/26/001 for everything else; it restarts every financial year on 1 April (26 = 2026-27).</p>
      {mode === "MANUAL" ? <p className="mt-3 text-sm text-signal-amber-ink">Manual stock requires invoice and independent approval. QC clearance remains a separate step.</p> : vendorId && !poOptions.length && !receivable.isLoading ? <p className="mt-3 text-sm text-signal-amber-ink">No approved open PO for this vendor. Complete PO approval or choose Manual GRN.</p> : null}
    </WorkPanel>
    <WorkPanel title="Supplier challan & invoice"><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4"><Field label="Supplier challan number *" hint="required"><input aria-label="Supplier challan number" data-testid="inward-challan-no" className={phoneField} value={invoice.challan_no} onChange={(event) => setInvoice({ ...invoice, challan_no: event.target.value })} placeholder="As printed on the delivery challan" /></Field><Field label="Invoice number"><input className={phoneField} disabled={invoice.pending} value={invoice.invoice_no} onChange={(event) => setInvoice({ ...invoice, invoice_no: event.target.value })} /></Field><Field label="Invoice date"><input className={phoneField} type="date" disabled={invoice.pending} aria-label={invoice.pending ? "Invoice date · pending" : "Invoice date"} value={invoice.pending ? "" : invoice.invoice_date} onChange={(event) => setInvoice({ ...invoice, invoice_date: event.target.value })} /></Field><label className="flex min-h-11 items-center gap-3 self-end text-sm"><input data-testid="inward-invoice-pending" className="h-5 w-5 shrink-0" type="checkbox" checked={invoice.pending} onChange={(event) => setInvoice({ ...invoice, pending: event.target.checked })} /> Challan received · invoice pending</label></div>{invoice.pending ? <p data-testid="inward-pending-help" className="mt-3 text-[12.5px] leading-5 text-muted-foreground">Invoice number and date are added later in the GRN register. You can still type each material&apos;s rate from the challan below; a rate different from the PO opens a review case now.</p> : null}</WorkPanel>
    {lines.map((line, index) => { const selected: any = material(line); const reel = isReel(line); const qty = quantity(line); const delta = selected?.approved_rate != null && line.invoice_rate !== "" ? Number(line.invoice_rate) - selected.approved_rate : 0
      return <WorkPanel key={line.key} title={`Material ${index + 1}`} description={selected ? `${selected.item_code} · ${selected.item_name || selected.name}${mode === "PO" ? ` · ${unitQty(selected.open_qty, selected.uom)} open` : ""}` : "Choose the exact variety before entering physical units."} action={<button className={secondaryButton} disabled={lines.length === 1} onClick={() => setLines(lines.filter((row) => row.key !== line.key))}><Trash2 className="h-4 w-4" /> Remove material</button>}>
        {/* Six desk columns so both row shapes fill with no gaps: material + where it goes, then the rates. */}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6"><div className="min-w-0 xl:col-span-3"><Field label={mode === "PO" ? "PO material / variety" : "Material / variety"}><select className={phoneField} value={mode === "PO" ? line.po_line_id : line.item_id} onChange={(event) => { const value = event.target.value; const chosen: any = mode === "PO" ? poLines.find((row) => row.po_line_id === value) : items.find((row) => String(row.id) === value); updateLine(line.key, { ...newLine(), key: line.key, location_id: line.location_id, po_line_id: mode === "PO" ? value : "", item_id: mode === "MANUAL" ? value : chosen?.item_id || "", invoice_rate: chosen?.approved_rate != null ? String(chosen.approved_rate) : "",
              // Received quantity follows the PO line's open quantity, not the item master (client 2026-10-26).
              quantity: mode === "PO" && chosen && chosen.tracking_mode !== "REEL" && Number(chosen.open_qty) > 0 ? String(chosen.open_qty) : "" }) }}><option value="">Select material</option>{(mode === "PO" ? poLines.filter((row) => row.po_line_id === line.po_line_id || !lines.some((candidate) => candidate.po_line_id === row.po_line_id)) : items).map((row: any) => <option key={row.po_line_id || row.id} value={row.po_line_id || row.id}>{row.item_code} · {row.item_name || row.name}</option>)}</select></Field></div>
          <div className="min-w-0 xl:col-span-3"><Field label="Put in location" hint="Required"><select aria-label={`Put material ${index + 1} in location`} aria-describedby={`inward-location-help-${line.key}`} data-testid="inward-location" className={phoneField} value={lineLocation(line)} onChange={(event) => updateLine(line.key, { location_id: event.target.value })}>{!putIn.length ? <option value="">{locationsQuery.isLoading ? "Loading locations…" : "RM store"}</option> : null}{putIn.map((row: any) => <option key={row.id} value={row.id}>{String(row.name || "").trim() || row.code}{row.is_receiving_default ? " (default)" : String(row.name || "").trim() && row.name !== row.code ? ` (${row.code})` : ""}</option>)}</select><span id={`inward-location-help-${line.key}`} className="block text-[12px] leading-4 text-muted-foreground" data-testid="inward-location-help">Goods land in {receivingName || "the RM store"} unless you pick another rack.</span></Field></div>
          {mode === "PO" ? <div className="min-w-0 xl:col-span-2"><Field label="Approved PO rate · locked"><input aria-label={`Material ${index + 1} approved PO rate`} data-testid="inward-po-rate" className={`${phoneField} bg-muted text-muted-foreground`} readOnly tabIndex={-1} value={selected?.approved_rate ?? ""} /></Field></div> : null}<div className={`min-w-0 ${mode === "PO" ? "xl:col-span-2" : "xl:col-span-3"}`}><Field label={`${invoice.pending ? "Challan / invoice rate" : "Invoice rate"} / ${unitWord(selected?.uom || "KG")}`} hint={invoice.pending ? "Editable · invoice to follow" : undefined}><input aria-label={`Material ${index + 1} invoice rate`} data-testid="inward-invoice-rate" className={phoneField} type="number" inputMode="decimal" min="0" step="0.0001" value={line.invoice_rate} onChange={(event) => updateLine(line.key, { invoice_rate: event.target.value })} /></Field></div><div className={`min-w-0 ${mode === "PO" ? "md:col-span-2 xl:col-span-2" : "xl:col-span-3"}`}><Field label="Invoice quantity" hint="Defaults to measured receipt"><input className={phoneField} type="number" min="0.001" step="0.001" disabled={invoice.pending} placeholder={String(qty || "")} value={line.invoice_quantity} onChange={(event) => updateLine(line.key, { invoice_quantity: event.target.value })} /></Field></div></div>
        {mode === "PO" && selected ? (() => { const after = Number(selected.open_qty || 0) - qty; const expected = selected.expected_unit_count; const countedBefore = Number(selected.received_unit_count || 0); const nowCount = reel ? line.lots.filter((lot) => lot.source_reel_no || lot.net_weight_kg).length : 0
          return <div data-testid="po-line-balance" className={`mt-3 grid gap-2 rounded-lg p-3 text-sm tabular-nums sm:grid-cols-2 xl:grid-cols-4 ${after < -1e-9 ? "bg-signal-rose-soft text-signal-rose-ink" : "bg-muted text-foreground"}`}>
            <p>PO ordered <strong>{unitQty(selected.ordered_qty, selected.uom)}</strong> · received {unitQty(selected.received_qty, selected.uom)}</p>
            <p>Open before this receipt <strong>{unitQty(selected.open_qty, selected.uom)}</strong></p>
            <p>This receipt <strong>{unitQty(qty, selected.uom)}</strong> · {after < -1e-9 ? <strong>more than the PO by {unitQty(-after, selected.uom)} — reason needed below</strong> : <>balance after <strong>{unitQty(after, selected.uom)}</strong></>}</p>
            {reel ? <p>Reels / coils <strong>{countedBefore + nowCount}</strong>{expected != null ? <> of about {expected} expected</> : null} · {nowCount} in this receipt</p> : null}
          </div> })() : null}
        {delta !== 0 ? <p data-testid="inward-rate-delta" className="mt-3 rounded-lg border border-signal-amber-line bg-signal-amber-soft p-3 text-sm text-signal-amber-ink">{invoice.pending ? "Challan rate" : "Invoice rate"} is ₹{Math.abs(delta).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} per {unitWord(selected?.uom || "KG")} {delta < 0 ? "less" : "more"} than the PO{qty > 0 ? ` (₹${Math.abs(qty * delta).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${delta < 0 ? "less" : "more"} for this receipt)` : ""}. A review case opens automatically; the approved PO stays unchanged.{invoice.pending ? " The invoice number and date stay pending; add them in the GRN register when the invoice comes." : ""}</p> : null}
        {selected && reel ? <div className="mt-5 space-y-3"><div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground"><strong className="text-foreground">{plural(filledLots(line).length, "reel / coil", "reels / coils")} entered · {qty.toLocaleString("en-IN")} kg net</strong> · empty rows are left out. Tab moves fields; Enter in the last field adds a row.</p><div className="flex flex-wrap gap-2"><button className={secondaryButton} onClick={() => addLot(line)}><Plus className="h-4 w-4" /> Add reel / coil</button><button data-testid="inward-add-ten" className={secondaryButton} onClick={() => addLot(line, LOT_ROWS)}><Plus className="h-4 w-4" /> Add 10 more</button></div></div><div className="overflow-x-auto rounded-lg border border-border"><table className="w-full min-w-[640px] text-sm"><thead className="bg-muted text-left text-xs text-muted-foreground"><tr>{["#", "Vendor reel / coil no.", "Net kg", "Width", "Unit", "Form", ""].map((head, i) => <th className="px-2 py-3 font-semibold" key={i}>{head}</th>)}</tr></thead><tbody onKeyDown={(event) => fastEntry(event, line)}>{line.lots.map((lot, lotIndex) => <tr key={lot.key} className="border-t border-border"><td className="px-2 tabular-nums text-muted-foreground">{lotIndex + 1}</td>{(["source_reel_no", "net_weight_kg", "width_mm"] as const).map((key) => <td className="p-1" key={key}><input id={key === "source_reel_no" ? `vendor-lot-${lot.key}` : undefined} aria-label={`Material ${index + 1} lot ${lotIndex + 1} ${key}`} className={`${phoneField} ${key === "source_reel_no" ? "min-w-40" : "min-w-24"}`} type={key === "source_reel_no" ? "text" : "number"} min="0.001" step="0.001" value={lot[key]} onChange={(event) => updateLot(line, lot.key, { [key]: event.target.value })} /></td>)}<td className="p-1"><select aria-label={`Lot ${lotIndex + 1} width unit`} className={phoneField} value={lot.width_unit} onChange={(event) => updateLot(line, lot.key, { width_unit: event.target.value as "MM" | "CM" })}><option value="MM">mm</option><option value="CM">cm</option></select></td><td className="p-1"><select aria-label={`Lot ${lotIndex + 1} form`} className={phoneField} value={lot.physical_form} onChange={(event) => updateLot(line, lot.key, { physical_form: event.target.value as Lot["physical_form"] })}><option value="REEL">Reel</option><option value="COIL">Coil</option></select></td><td className="p-1"><button aria-label={`Remove lot ${lotIndex + 1}`} className="flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-signal-rose-soft hover:text-signal-rose-ink disabled:opacity-30" disabled={line.lots.length === 1} onClick={() => updateLine(line.key, { lots: line.lots.filter((candidate) => candidate.key !== lot.key) })}><Trash2 className="h-4 w-4" /></button></td></tr>)}</tbody></table></div><details className="rounded-lg bg-muted p-3"><summary className="-my-1 cursor-pointer py-3 text-sm leading-5 font-medium text-signal-cyan-ink">Paste measured lot rows from Excel</summary><p className="my-2 text-xs text-muted-foreground">Columns: vendor reel number, net kg, width mm, REEL/COIL. Rows are added after the rows already filled.</p><textarea className={`${phoneField} h-24 py-2 font-mono text-xs`} value={paste[line.key] || ""} onChange={(event) => setPaste({ ...paste, [line.key]: event.target.value })} /><button className={`${secondaryButton} mt-2`} onClick={() => pasteLots(line)}>Append pasted lots</button></details></div> : selected ? <div className="mt-4 grid gap-3 md:grid-cols-2"><Field label={`Received quantity · ${unitWord(selected.uom || "KG")}`} hint={mode === "PO" ? `PO open ${unitQty(selected.open_qty, selected.uom || "KG")}` : undefined}><input className={phoneField} type="number" min="0.001" step={String(selected.uom).toUpperCase() === "PCS" ? "1" : "0.001"} value={line.quantity} onChange={(event) => updateLine(line.key, { quantity: event.target.value })} /></Field><Field label="Batch number · optional"><input className={phoneField} value={line.batch_no} onChange={(event) => updateLine(line.key, { batch_no: event.target.value })} /></Field></div> : null}
      </WorkPanel> })}
    <button className={secondaryButton} disabled={!vendorId || (mode === "PO" && !poId)} onClick={() => setLines([...lines, newLine()])}><Plus className="h-4 w-4" /> Add another material</button>
    {mode === "PO" && exceedsPo ? <WorkPanel title="More than the PO" description="This receipt is more than the PO line still has open. It can be received only with a reason; the reason is kept on the GRN."><Field label="Reason for receiving more than the PO *"><input data-testid="inward-over-reason" className={phoneField} value={overReason} onChange={(event) => setOverReason(event.target.value)} placeholder="e.g. last reel of the order, supplier confirmed extra kg" /></Field></WorkPanel> : null}
    {preview ? <WorkPanel title="Validation result">{preview.warnings?.length ? <div data-testid="inward-warnings" className="mb-3 space-y-1 rounded-lg border border-signal-amber-line bg-signal-amber-soft p-3 text-sm text-signal-amber-ink">{preview.warnings.map((text: string) => <p key={text}>{text}</p>)}<p className="text-xs">You can still post it if this is a different delivery.</p></div> : null}<div className="space-y-2">{preview.lines.map((row: any, i: number) => <p key={i} className="text-sm"><strong>{row.item_code}</strong> · {unitQty(row.quantity_kg, row.uom || "KG")}{String(row.tracking_mode || "").toUpperCase() === "REEL" ? ` · ${plural(Number(row.physical_unit_count || 0), "reel / coil", "reels / coils")}` : ""}{commercialWord(row.commercial_status || preview.commercial_status) ? ` · ${commercialWord(row.commercial_status || preview.commercial_status)}` : ""}{row.rate_review && String(row.commercial_status || "").toUpperCase() === "INVOICE_PENDING" ? " · rate differs from the PO · goes to Accounts" : ""}{row.over_po_qty > 0 ? ` · ${unitQty(row.over_po_qty, row.uom || "KG")} more than the PO` : ""}</p>)}</div></WorkPanel> : null}
    <div className="sticky bottom-3 z-20 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card/95 p-4 shadow-lg backdrop-blur"><div><p className="font-semibold tabular-nums text-foreground">{plural(lines.length, "material")}{lotCount ? ` · ${plural(lotCount, "reel / coil", "reels / coils")}` : ""} · {quantitySummary || "nothing"} received</p><p className="mt-1 text-xs text-muted-foreground">{invoice.pending ? (totalValue > 0 ? `Value ₹${totalValue.toLocaleString("en-IN", { maximumFractionDigits: 2 })} at the challan rate · invoice pending` : "Invoice pending") : `Invoice value ₹${totalValue.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`} · Each physical unit gets one QR label</p></div><div className="flex gap-2"><button className={secondaryButton} disabled={busy} onClick={() => { try { validate.mutate(payload()) } catch (error) { setNotice({ tone: "error", text: errorText(error) }) } }}>Validate receipt</button><button className={primaryButton} disabled={busy || (exceedsPo && overReason.trim().length < 3) || !reviewedPayload || !vendorId || total <= 0} onClick={() => post.mutate()}><PackageCheck className="h-4 w-4" />{post.isPending ? "Posting…" : "Post goods inward"}</button></div></div>
    </fieldset></>}
  </ProcurementShell></RoleGate>
}

// useSearchParams needs a Suspense boundary in Next 15 (SPEC section 6), or the build bails out.
export default function PurchaseInwardPageWithSearch() {
  return (
    <Suspense fallback={null}>
      <PurchaseInwardPage />
    </Suspense>
  )
}
