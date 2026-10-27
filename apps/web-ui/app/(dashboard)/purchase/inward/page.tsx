"use client"

import Link from "next/link"
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import type { KeyboardEvent } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus, Trash2, ArrowRight, PackageCheck } from "lucide-react"
import { useSearchParams } from "next/navigation"
import { Field, MessageBar, ProcurementShell, WorkPanel, fieldClass, primaryButton, secondaryButton } from "@/components/procurement/procurement-shell"
import { LabelPrintControls } from "@/components/procurement/label-print-controls"
import { LotLabels } from "@/components/procurement/lot-labels"
import { RoleGate } from "@/components/workspace/role-gate"
import { useAuth } from "@/context/AuthContext"
import { useInventoryItems } from "@/hooks/use-inventory"
import { useVendors } from "@/hooks/use-master-data"
import { purchaseApi } from "@/lib/api"
import { businessDate } from "@/lib/business-date"
import type { ReceivableLine } from "@/lib/procurement-types"

// Net weight only (client 2026-10-26): no gross / tare and no vendor batch at inward.
type Lot = { key: string; source_reel_no: string; net_weight_kg: string; width_mm: string; width_unit: "MM" | "CM"; physical_form: "REEL" | "COIL" }
type Line = { key: string; item_id: string; po_line_id: string; quantity: string; invoice_quantity: string; invoice_rate: string; batch_no: string; lots: Lot[] }
/** The reel / coil grid opens with 10 empty rows; empty rows are ignored on save. */
const LOT_ROWS = 10
const newLot = (previous?: Lot): Lot => ({ key: crypto.randomUUID(), source_reel_no: "", net_weight_kg: "", width_mm: previous?.width_mm || "", width_unit: previous?.width_unit || "MM", physical_form: previous?.physical_form || "REEL" })
const blankLots = (count: number, previous?: Lot): Lot[] => { const out: Lot[] = []; for (let i = 0; i < count; i += 1) out.push(newLot(out.at(-1) || previous)); return out }
const lotFilled = (lot: Lot) => Boolean(lot.source_reel_no.trim() || String(lot.net_weight_kg).trim())
const filledLots = (line: Line) => line.lots.filter(lotFilled)
const newLine = (): Line => ({ key: crypto.randomUUID(), item_id: "", po_line_id: "", quantity: "", invoice_quantity: "", invoice_rate: "", batch_no: "", lots: blankLots(LOT_ROWS) })
const errorText = (error: any) => typeof error?.response?.data?.detail === "string" ? error.response.data.detail : error.message || "Review the form and try again."

/** Where held stock goes next, and who clears it (client 2026-10-18: "approval ke liye kiske pass jayega"). */
function commercialNext(status: string | null | undefined): string {
  switch (String(status || "").toUpperCase()) {
    case "CLEAR": return "Commercial rates matched; lots go to incoming QC."
    case "INVOICE_PENDING": return "Stock is held until the supplier invoice is attached: Store attaches it in Purchase › GRN register when it arrives."
    case "RATE_REVIEW":
    case "REVIEW_REQUIRED": return "Invoice rate or quantity differs from the PO, so stock is held. The plant head or Accounts decides it in Purchase › Invoice differences (not the person who made this GRN). They have been notified."
    case "MANUAL_REVIEW": return "Manual GRN without a PO: the plant head or Accounts approves it in Purchase › GRN register (not the person who made it). They have been notified."
    default: return "Stock is held pending commercial approval by the plant head or Accounts."
  }
}

export default function PurchaseInwardPage() {
  const { activePlant } = useAuth(); const client = useQueryClient()
  const vendorsQuery = useVendors(); const itemsQuery = useInventoryItems()
  const vendors: any[] = Array.isArray(vendorsQuery.data) ? vendorsQuery.data : []
  const items: any[] = Array.isArray(itemsQuery.data) ? itemsQuery.data.filter((item: any) => item.type !== "FINISHED_GOOD") : []
  const receivable = useQuery({ queryKey: ["purchase-v2", "receivable", activePlant], enabled: Boolean(activePlant && activePlant !== "ALL"), queryFn: () => purchaseApi.getReceivableLines() })
  const available: ReceivableLine[] = receivable.data?.data?.items || []
  const searchParams = useSearchParams()
  const [mode, setMode] = useState<"PO" | "MANUAL">("PO")
  const [vendorId, setVendorId] = useState(""); const [poId, setPoId] = useState("")
  // Opened from a PO ("Receive goods"): preselect its vendor, PO and, when given, the material line.
  const prefill = useRef(false)
  useEffect(() => {
    if (prefill.current || !available.length) return
    const wantedPo = searchParams.get("po"); const wantedLine = searchParams.get("line")
    if (!wantedPo) return
    const row = available.find((item) => item.po_id === wantedPo)
    if (!row) { prefill.current = true; setNotice({ tone: "info", text: "That purchase order has nothing open to receive (fully received, not approved yet, or closed)." }); return }
    prefill.current = true
    setMode("PO"); setVendorId(row.supplier_id); setPoId(row.po_id)
    setLines([{ ...newLine(), po_line_id: wantedLine && available.some((item) => item.po_line_id === wantedLine) ? wantedLine : "" }])
    setNotice({ tone: "info", text: `Receiving against ${row.po_no} · ${row.supplier_name}. Vendor and PO are filled from the purchase order.` })
  }, [available, searchParams])
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
  const quantitySummary = Object.entries(lines.reduce((totals, line) => { const uom = material(line)?.uom || "KG"; totals[uom] = (totals[uom] || 0) + quantity(line); return totals }, {} as Record<string, number>)).map(([uom, qty]) => `${qty.toLocaleString("en-IN")} ${uom}`).join(" + ")
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
      if (isReel(line)) filledLots(line).forEach((lot) => {
        const identity = lot.source_reel_no.trim().toUpperCase()
        if (!identity || seen.has(identity) || Number(lot.net_weight_kg) <= 0 || Number(lot.width_mm) <= 0) throw new Error(`Material ${index + 1}: each filled row needs its own vendor reel number, net kg and width.`)
        seen.add(identity)
      })
      return {
        ...(mode === "PO" ? { po_line_id: line.po_line_id } : { item_id: line.item_id, incoming_qc_required: true }),
        quantity: isReel(line) ? undefined : Number(line.quantity), invoice_quantity: invoice.pending ? undefined : Number(line.invoice_quantity || quantity(line)),
        invoice_rate: invoice.pending ? undefined : Number(line.invoice_rate), batch_no: isReel(line) ? undefined : line.batch_no || undefined,
        lots: isReel(line) ? filledLots(line).map(({ key, width_unit, ...lot }) => ({ ...lot, source_reel_no: lot.source_reel_no.trim(), net_weight_kg: Number(lot.net_weight_kg), width_mm: Number(lot.width_mm) * (width_unit === "CM" ? 10 : 1) })) : [],
      }
    })
    const body = { ...(mode === "PO" ? { purchase_order_id: poId } : { supplier_id: vendorId, supplier_name: vendor.name, reason: invoice.reason }), received_date: businessDate(), supplier_challan_no: invoice.challan_no.trim(), invoice_pending: invoice.pending, invoice_no: invoice.pending ? undefined : invoice.invoice_no, invoice_date: invoice.pending ? undefined : invoice.invoice_date, currency: "INR", ...(mode === "PO" && exceedsPo ? { over_receipt_reason: overReason.trim() } : {}), lines: receivedLines }
    const fingerprint = JSON.stringify(body)
    if (!request.current || request.current.fingerprint !== fingerprint) request.current = { key: crypto.randomUUID(), fingerprint }
    return { ...body, request_id: request.current.key }
  }
  const validate = useMutation({ mutationFn: (body: any) => mode === "PO" ? purchaseApi.previewReceipt(body) : purchaseApi.previewManualReceipt(body), onSuccess: ({ data }, body) => { setPreview(data); setReviewedPayload(body); setNotice(null) }, onError: (error) => setNotice({ tone: "error", text: errorText(error) }) })
  const post = useMutation({ mutationFn: () => { if (!reviewedPayload || JSON.stringify(payload()) !== JSON.stringify(reviewedPayload)) throw new Error("Receipt details changed. Validate them again before posting."); return mode === "PO" ? purchaseApi.createReceipt(reviewedPayload) : purchaseApi.createManualReceipt(reviewedPayload) }, onSuccess: ({ data }) => { setPosted(data); setNotice({ tone: data.warnings?.length ? "info" : "success", text: `Inward ${data.grn_no} saved (challan ${data.supplier_challan_no || "—"}). ${data.lot_count} individual lots recorded. ${commercialNext(data.commercial_status)}${data.warnings?.length ? ` Note: ${data.warnings.join(" ")}` : ""}` }); client.invalidateQueries({ queryKey: ["purchase-v2"] }) }, onError: (error) => setNotice({ tone: "error", text: errorText(error) }) })
  const busy = post.isPending || validate.isPending
  const exceedsPo = mode === "PO" && lines.some((line) => { const row: any = material(line); return row && quantity(line) > Number(row.open_qty || 0) + 1e-9 })

  return <RoleGate allow={["Store", "PlantManager", "GRN"]}><ProcurementShell eyebrow="Stores / goods inward" title="Receive materials" description="Choose the vendor and receipt source, then enter each material and its actual weighed reels or coils." actions={<Link className={secondaryButton} href="/purchase/receipts">GRN register <ArrowRight className="h-4 w-4" /></Link>}>
    {notice ? <MessageBar tone={notice.tone}>{notice.text}</MessageBar> : null}
    {receivable.isError || vendorsQuery.isError || itemsQuery.isError ? <MessageBar tone="error">Receipt masters could not load. Refresh before entering stock.</MessageBar> : null}
    {posted ? <><WorkPanel title="Receipt saved" description="Every physical unit has its own permanent AT identity. Open the register for approvals, invoice attachment, QC and later reprints." action={<button className={primaryButton} onClick={() => { reset(); setInvoice({ challan_no: "", invoice_no: "", invoice_date: businessDate(), pending: false, reason: "" }) }}>Start next receipt</button>}><div className="flex flex-wrap gap-3"><Link className={secondaryButton} href={`/purchase/receipts/${posted.id}`}>Open saved receipt</Link>{posted.lot_count > 0 ? <LabelPrintControls lots={posted.lots || posted.created_lots || []} /> : null}</div></WorkPanel><LotLabels lots={posted.lots || posted.created_lots || []} /></> : <>
    <fieldset disabled={busy} className="contents">
    <WorkPanel title="Vendor & receipt source">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4"><Field label="Receipt source"><select className={fieldClass} value={mode} onChange={(event) => { setMode(event.target.value as typeof mode); reset() }}><option value="PO">Against approved system PO</option><option value="MANUAL">Manual GRN · without PO</option></select></Field><Field label="Vendor"><select className={fieldClass} value={vendorId} onChange={(event) => { setVendorId(event.target.value); setPoId(""); reset() }}><option value="">Select vendor</option>{vendors.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></Field>{mode === "PO" ? <Field label="Approved purchase order"><select className={fieldClass} value={poId} disabled={!vendorId} onChange={(event) => { setPoId(event.target.value); reset() }}><option value="">Select approved PO</option>{poOptions.map((row) => <option key={row.po_id} value={row.po_id}>{row.po_no} · revision {row.revision_no}</option>)}</select></Field> : <Field label="Reason for no PO"><input className={fieldClass} value={invoice.reason} onChange={(event) => setInvoice({ ...invoice, reason: event.target.value })} placeholder="e.g. approved urgent local purchase" /></Field>}<Field label="Inward date · automatic"><input className={fieldClass} disabled value={businessDate()} /></Field></div>
      {vendor ? <p data-testid="inward-vendor-details" className="mt-3 flex flex-wrap gap-x-4 gap-y-1 rounded-lg border border-border bg-muted/60 px-3 py-2 text-[12.5px] text-muted-foreground"><span>GSTIN <strong className="font-mono text-foreground">{vendor.gst_no || "not in vendor master"}</strong></span>{vendor.city || vendor.state ? <span>{[vendor.city, vendor.state].filter(Boolean).join(", ")}{vendor.pin_code ? ` - ${vendor.pin_code}` : ""}</span> : null}{vendor.contact_name || vendor.contact_phone ? <span>Contact {[vendor.contact_name, vendor.contact_phone].filter(Boolean).join(" · ")}</span> : null}</p> : null}
      <p className="mt-3 text-[12.5px] leading-5 text-muted-foreground"><strong className="text-foreground">Net weight only:</strong> enter the net kg of each reel or coil (paper alone). Stock, the PO balance and the invoice all go by net kg. <strong className="text-foreground">Inward number</strong> is given on save: P/26/001 for paper, A/26/001 for adhesive, IN/26/001 for everything else; it restarts every year.</p>
      {mode === "MANUAL" ? <p className="mt-3 text-sm text-signal-amber-ink">Manual stock requires invoice and independent approval. QC clearance remains a separate step.</p> : vendorId && !poOptions.length && !receivable.isLoading ? <p className="mt-3 text-sm text-signal-amber-ink">No approved open PO for this vendor. Complete PO approval or choose Manual GRN.</p> : null}
    </WorkPanel>
    <WorkPanel title="Supplier challan & invoice"><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4"><Field label="Supplier challan number *" hint="required"><input aria-label="Supplier challan number" data-testid="inward-challan-no" className={fieldClass} value={invoice.challan_no} onChange={(event) => setInvoice({ ...invoice, challan_no: event.target.value })} placeholder="As printed on the delivery challan" /></Field><Field label="Invoice number"><input className={fieldClass} disabled={invoice.pending} value={invoice.invoice_no} onChange={(event) => setInvoice({ ...invoice, invoice_no: event.target.value })} /></Field><Field label="Invoice date"><input className={fieldClass} type="date" disabled={invoice.pending} value={invoice.invoice_date} onChange={(event) => setInvoice({ ...invoice, invoice_date: event.target.value })} /></Field><label className="flex min-h-11 items-center gap-3 self-end text-sm"><input type="checkbox" checked={invoice.pending} onChange={(event) => setInvoice({ ...invoice, pending: event.target.checked })} /> Challan received · invoice pending</label></div></WorkPanel>
    {lines.map((line, index) => { const selected: any = material(line); const reel = isReel(line); const qty = quantity(line); const delta = selected?.approved_rate != null && line.invoice_rate !== "" ? Number(line.invoice_rate) - selected.approved_rate : 0
      return <WorkPanel key={line.key} title={`Material ${index + 1}`} description={selected ? `${selected.item_code} · ${selected.item_name || selected.name}${mode === "PO" ? ` · ${selected.open_qty.toLocaleString("en-IN")} ${selected.uom} open` : ""}` : "Choose the exact variety before entering physical units."} action={<button className={secondaryButton} disabled={lines.length === 1} onClick={() => setLines(lines.filter((row) => row.key !== line.key))}><Trash2 className="h-4 w-4" /> Remove material</button>}>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"><Field label={mode === "PO" ? "PO material / variety" : "Material / variety"}><select className={fieldClass} value={mode === "PO" ? line.po_line_id : line.item_id} onChange={(event) => { const value = event.target.value; const chosen: any = mode === "PO" ? poLines.find((row) => row.po_line_id === value) : items.find((row) => String(row.id) === value); updateLine(line.key, { ...newLine(), key: line.key, po_line_id: mode === "PO" ? value : "", item_id: mode === "MANUAL" ? value : chosen?.item_id || "", invoice_rate: chosen?.approved_rate != null ? String(chosen.approved_rate) : "",
              // Received quantity follows the PO line's open quantity, not the item master (client 2026-10-26).
              quantity: mode === "PO" && chosen && chosen.tracking_mode !== "REEL" && Number(chosen.open_qty) > 0 ? String(chosen.open_qty) : "" }) }}><option value="">Select material</option>{(mode === "PO" ? poLines.filter((row) => row.po_line_id === line.po_line_id || !lines.some((candidate) => candidate.po_line_id === row.po_line_id)) : items).map((row: any) => <option key={row.po_line_id || row.id} value={row.po_line_id || row.id}>{row.item_code} · {row.item_name || row.name}</option>)}</select></Field>{mode === "PO" ? <Field label="Approved rate · locked"><input className={fieldClass} readOnly value={selected?.approved_rate ?? ""} /></Field> : null}<Field label={`Invoice rate / ${selected?.uom || "kg"}`}><input className={fieldClass} type="number" min="0" step="0.0001" disabled={invoice.pending} value={line.invoice_rate} onChange={(event) => updateLine(line.key, { invoice_rate: event.target.value })} /></Field><Field label="Invoice quantity" hint="Defaults to measured receipt"><input className={fieldClass} type="number" min="0.001" step="0.001" disabled={invoice.pending} placeholder={String(qty || "")} value={line.invoice_quantity} onChange={(event) => updateLine(line.key, { invoice_quantity: event.target.value })} /></Field></div>
        {mode === "PO" && selected ? (() => { const after = Number(selected.open_qty || 0) - qty; const expected = selected.expected_unit_count; const countedBefore = Number(selected.received_unit_count || 0); const nowCount = reel ? line.lots.filter((lot) => lot.source_reel_no || lot.net_weight_kg).length : 0
          return <div data-testid="po-line-balance" className={`mt-3 grid gap-2 rounded-lg p-3 text-sm tabular-nums sm:grid-cols-2 xl:grid-cols-4 ${after < -1e-9 ? "bg-signal-rose-soft text-signal-rose-ink" : "bg-muted text-foreground"}`}>
            <p>PO ordered <strong>{Number(selected.ordered_qty || 0).toLocaleString("en-IN")} {selected.uom}</strong> · received {Number(selected.received_qty || 0).toLocaleString("en-IN")}</p>
            <p>Open before this receipt <strong>{Number(selected.open_qty || 0).toLocaleString("en-IN")} {selected.uom}</strong></p>
            <p>This receipt <strong>{qty.toLocaleString("en-IN")} {selected.uom}</strong> · {after < -1e-9 ? <strong>more than the PO by {(-after).toLocaleString("en-IN")} {selected.uom} — reason needed below</strong> : <>balance after <strong>{after.toLocaleString("en-IN")} {selected.uom}</strong></>}</p>
            {reel ? <p>Reels / coils <strong>{countedBefore + nowCount}</strong>{expected != null ? <> of about {expected} expected</> : null} · {nowCount} in this receipt</p> : null}
          </div> })() : null}
        {delta !== 0 && !invoice.pending ? <p className="mt-3 rounded-lg bg-signal-amber-soft p-3 text-sm text-signal-amber-ink">Invoice rate differs by ₹{delta.toFixed(4)} per unit (₹{(qty * delta).toFixed(2)} for this receipt). A review case opens automatically; the approved PO stays unchanged.</p> : null}
        {selected && reel ? <div className="mt-5 space-y-3"><div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground"><strong className="text-foreground">{filledLots(line).length} reels / coils entered · {qty.toLocaleString("en-IN")} kg net</strong> · empty rows are left out. Tab moves fields; Enter in the last field adds a row.</p><div className="flex flex-wrap gap-2"><button className={secondaryButton} onClick={() => addLot(line)}><Plus className="h-4 w-4" /> Add reel / coil</button><button data-testid="inward-add-ten" className={secondaryButton} onClick={() => addLot(line, LOT_ROWS)}><Plus className="h-4 w-4" /> Add 10 more</button></div></div><div className="overflow-x-auto rounded-lg border border-border"><table className="w-full min-w-[640px] text-sm"><thead className="bg-muted text-left text-xs text-muted-foreground"><tr>{["#", "Vendor reel / coil no.", "Net kg", "Width", "Unit", "Form", ""].map((head, i) => <th className="px-2 py-3 font-semibold" key={i}>{head}</th>)}</tr></thead><tbody onKeyDown={(event) => fastEntry(event, line)}>{line.lots.map((lot, lotIndex) => <tr key={lot.key} className="border-t border-border"><td className="px-2 tabular-nums text-muted-foreground">{lotIndex + 1}</td>{(["source_reel_no", "net_weight_kg", "width_mm"] as const).map((key) => <td className="p-1" key={key}><input id={key === "source_reel_no" ? `vendor-lot-${lot.key}` : undefined} aria-label={`Material ${index + 1} lot ${lotIndex + 1} ${key}`} className={`${fieldClass} ${key === "source_reel_no" ? "min-w-40" : "min-w-24"}`} type={key === "source_reel_no" ? "text" : "number"} min="0.001" step="0.001" value={lot[key]} onChange={(event) => updateLot(line, lot.key, { [key]: event.target.value })} /></td>)}<td className="p-1"><select aria-label={`Lot ${lotIndex + 1} width unit`} className={fieldClass} value={lot.width_unit} onChange={(event) => updateLot(line, lot.key, { width_unit: event.target.value as "MM" | "CM" })}><option value="MM">mm</option><option value="CM">cm</option></select></td><td className="p-1"><select aria-label={`Lot ${lotIndex + 1} form`} className={fieldClass} value={lot.physical_form} onChange={(event) => updateLot(line, lot.key, { physical_form: event.target.value as Lot["physical_form"] })}><option value="REEL">Reel</option><option value="COIL">Coil</option></select></td><td className="p-1"><button aria-label={`Remove lot ${lotIndex + 1}`} className="flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-signal-rose-soft hover:text-signal-rose-ink disabled:opacity-30" disabled={line.lots.length === 1} onClick={() => updateLine(line.key, { lots: line.lots.filter((candidate) => candidate.key !== lot.key) })}><Trash2 className="h-4 w-4" /></button></td></tr>)}</tbody></table></div><details className="rounded-lg bg-muted p-3"><summary className="cursor-pointer text-sm font-medium text-signal-cyan-ink">Paste measured lot rows from Excel</summary><p className="my-2 text-xs text-muted-foreground">Columns: vendor reel number, net kg, width mm, REEL/COIL. Rows are added after the rows already filled.</p><textarea className={`${fieldClass} h-24 py-2 font-mono text-xs`} value={paste[line.key] || ""} onChange={(event) => setPaste({ ...paste, [line.key]: event.target.value })} /><button className={`${secondaryButton} mt-2`} onClick={() => pasteLots(line)}>Append pasted lots</button></details></div> : selected ? <div className="mt-4 grid gap-3 md:grid-cols-2"><Field label={`Received quantity · ${selected.uom || "KG"}`} hint={mode === "PO" ? `PO open ${Number(selected.open_qty || 0).toLocaleString("en-IN")} ${selected.uom || "KG"}` : undefined}><input className={fieldClass} type="number" min="0.001" step={String(selected.uom).toUpperCase() === "PCS" ? "1" : "0.001"} value={line.quantity} onChange={(event) => updateLine(line.key, { quantity: event.target.value })} /></Field><Field label="Batch number · optional"><input className={fieldClass} value={line.batch_no} onChange={(event) => updateLine(line.key, { batch_no: event.target.value })} /></Field></div> : null}
      </WorkPanel> })}
    <button className={secondaryButton} disabled={!vendorId || (mode === "PO" && !poId)} onClick={() => setLines([...lines, newLine()])}><Plus className="h-4 w-4" /> Add another material</button>
    {mode === "PO" && exceedsPo ? <WorkPanel title="More than the PO" description="This receipt is more than the PO line still has open. It can be received only with a reason; the reason is kept on the GRN."><Field label="Reason for receiving more than the PO *"><input data-testid="inward-over-reason" className={fieldClass} value={overReason} onChange={(event) => setOverReason(event.target.value)} placeholder="e.g. last reel of the order, supplier confirmed extra kg" /></Field></WorkPanel> : null}
    {preview ? <WorkPanel title="Validation result">{preview.warnings?.length ? <div data-testid="inward-warnings" className="mb-3 space-y-1 rounded-lg border border-signal-amber-line bg-signal-amber-soft p-3 text-sm text-signal-amber-ink">{preview.warnings.map((text: string) => <p key={text}>{text}</p>)}<p className="text-xs">You can still post it if this is a different delivery.</p></div> : null}<div className="space-y-2">{preview.lines.map((row: any, i: number) => <p key={i} className="text-sm"><strong>{row.item_code}</strong> · {row.quantity_kg.toLocaleString("en-IN")} {row.uom || "KG"} · {row.physical_unit_count} lots · {row.commercial_status || preview.commercial_status}{row.over_po_qty > 0 ? ` · ${Number(row.over_po_qty).toLocaleString("en-IN")} ${row.uom || "KG"} more than the PO` : ""}</p>)}</div></WorkPanel> : null}
    <div className="sticky bottom-3 z-20 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card/95 p-4 shadow-lg backdrop-blur"><div><p className="font-semibold tabular-nums text-foreground">{lines.length} materials · {lotCount} reels / coils · {quantitySummary} received</p><p className="mt-1 text-xs text-muted-foreground">Invoice value {invoice.pending ? "pending" : `₹${totalValue.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`} · Each physical unit gets one QR label</p></div><div className="flex gap-2"><button className={secondaryButton} disabled={busy} onClick={() => { try { validate.mutate(payload()) } catch (error) { setNotice({ tone: "error", text: errorText(error) }) } }}>Validate receipt</button><button className={primaryButton} disabled={busy || (exceedsPo && overReason.trim().length < 3) || !reviewedPayload || !vendorId || total <= 0} onClick={() => post.mutate()}><PackageCheck className="h-4 w-4" />{post.isPending ? "Posting…" : "Post goods inward"}</button></div></div>
    </fieldset></>}
  </ProcurementShell></RoleGate>
}
