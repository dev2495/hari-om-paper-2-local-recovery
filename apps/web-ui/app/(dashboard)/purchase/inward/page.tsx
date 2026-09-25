"use client"

import Link from "next/link"
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import type { KeyboardEvent } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus, Trash2, ArrowRight, PackageCheck } from "lucide-react"
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

type Lot = { key: string; source_reel_no: string; net_weight_kg: string; width_mm: string; physical_form: "REEL" | "COIL"; gross_weight_kg: string; tare_weight_kg: string; vendor_batch_no: string }
type Line = { key: string; item_id: string; po_line_id: string; quantity: string; invoice_quantity: string; invoice_rate: string; batch_no: string; lots: Lot[] }
const newLot = (previous?: Lot): Lot => ({ key: crypto.randomUUID(), source_reel_no: "", net_weight_kg: "", width_mm: previous?.width_mm || "", physical_form: previous?.physical_form || "REEL", gross_weight_kg: "", tare_weight_kg: "", vendor_batch_no: previous?.vendor_batch_no || "" })
const newLine = (): Line => ({ key: crypto.randomUUID(), item_id: "", po_line_id: "", quantity: "", invoice_quantity: "", invoice_rate: "", batch_no: "", lots: [newLot()] })
const errorText = (error: any) => typeof error?.response?.data?.detail === "string" ? error.response.data.detail : error.message || "Review the form and try again."

export default function PurchaseInwardPage() {
  const { activePlant } = useAuth(); const client = useQueryClient()
  const vendorsQuery = useVendors(); const itemsQuery = useInventoryItems()
  const vendors: any[] = Array.isArray(vendorsQuery.data) ? vendorsQuery.data : []
  const items: any[] = Array.isArray(itemsQuery.data) ? itemsQuery.data.filter((item: any) => item.type !== "FINISHED_GOOD") : []
  const receivable = useQuery({ queryKey: ["purchase-v2", "receivable", activePlant], enabled: Boolean(activePlant && activePlant !== "ALL"), queryFn: () => purchaseApi.getReceivableLines() })
  const available: ReceivableLine[] = receivable.data?.data?.items || []
  const [mode, setMode] = useState<"PO" | "MANUAL">("PO")
  const [vendorId, setVendorId] = useState(""); const [poId, setPoId] = useState("")
  const [lines, setLines] = useState<Line[]>([newLine()])
  const [invoice, setInvoice] = useState({ invoice_no: "", invoice_date: businessDate(), pending: false, reason: "" })
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
  useEffect(() => { setPreview(null); setReviewedPayload(null) }, [mode, vendorId, poId, lines, invoice])
  const vendor = vendors.find((row) => String(row.id) === vendorId)
  const poOptions = Array.from(new Map(available.filter((row) => row.supplier_id === vendorId).map((row) => [row.po_id, row])).values())
  const poLines = available.filter((row) => row.po_id === poId)
  const material = (line: Line) => mode === "PO" ? poLines.find((row) => row.po_line_id === line.po_line_id) : items.find((row) => String(row.id) === line.item_id)
  const isReel = (line: Line) => material(line)?.tracking_mode === "REEL"
  const quantity = (line: Line) => isReel(line) ? line.lots.reduce((sum, lot) => sum + Number(lot.net_weight_kg || 0), 0) : Number(line.quantity || 0)
  const total = lines.reduce((sum, line) => sum + quantity(line), 0)
  const quantitySummary = Object.entries(lines.reduce((totals, line) => { const uom = material(line)?.uom || "KG"; totals[uom] = (totals[uom] || 0) + quantity(line); return totals }, {} as Record<string, number>)).map(([uom, qty]) => `${qty.toLocaleString("en-IN")} ${uom}`).join(" + ")
  const lotCount = lines.reduce((sum, line) => sum + (isReel(line) ? line.lots.length : 0), 0)
  const totalValue = lines.reduce((sum, line) => sum + quantity(line) * Number(line.invoice_rate || 0), 0)
  const updateLine = (key: string, patch: Partial<Line>) => { setLines((current) => current.map((line) => line.key === key ? { ...line, ...patch } : line)); setPreview(null) }
  const reset = () => { setLines([newLine()]); setPreview(null); setPosted(null); request.current = null }
  const updateLot = (line: Line, key: string, patch: Partial<Lot>) => {
    setLines((current) => current.map((row) => row.key === line.key ? { ...row, lots: row.lots.map((lot) => lot.key === key ? { ...lot, ...patch } : lot) } : row))
    setPreview(null)
  }
  function addLot(line: Line) {
    const lot = newLot(line.lots.at(-1))
    pendingLotFocus.current = lot.key
    setLines((current) => current.map((row) => row.key === line.key ? { ...row, lots: [...row.lots, lot] } : row))
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
      const [source_reel_no, net_weight_kg, width_mm, form = "REEL", gross_weight_kg = "", tare_weight_kg = "", vendor_batch_no = ""] = row.split(/\t|,/).map((value) => value.trim())
      return { ...newLot(), source_reel_no, net_weight_kg, width_mm, physical_form: form.toUpperCase() as Lot["physical_form"], gross_weight_kg, tare_weight_kg, vendor_batch_no }
    })
    if (!parsed.length || parsed.some((lot) => !lot.source_reel_no || !Number.isFinite(Number(lot.net_weight_kg)) || Number(lot.net_weight_kg) <= 0 || Number(lot.width_mm) <= 0 || !["REEL", "COIL"].includes(lot.physical_form))) {
      setNotice({ tone: "error", text: "Every pasted row needs vendor lot, positive net kg, width mm and REEL or COIL." }); return
    }
    updateLine(line.key, { lots: [...line.lots.filter((lot) => lot.source_reel_no || lot.net_weight_kg), ...parsed] }); setPaste({ ...paste, [line.key]: "" })
  }
  function payload() {
    if (!vendorId || !vendor || (mode === "PO" && !poId)) throw new Error("Select vendor and an approved PO, or choose Manual GRN.")
    if (mode === "MANUAL" && invoice.reason.trim().length < 3) throw new Error("Explain why this material is received without a PO.")
    if (!invoice.pending && (!invoice.invoice_no.trim() || !invoice.invoice_date)) throw new Error("Enter invoice number and date, or mark invoice pending.")
    const seen = new Set<string>()
    const receivedLines = lines.map((line, index) => {
      if (!material(line) || quantity(line) <= 0) throw new Error(`Line ${index + 1}: select material and enter measured quantity.`)
      if (!invoice.pending && (line.invoice_rate === "" || Number(line.invoice_rate) < 0)) throw new Error(`Line ${index + 1}: enter the invoice rate.`)
      if (isReel(line)) line.lots.forEach((lot) => {
        const identity = lot.source_reel_no.trim().toUpperCase()
        if (!identity || seen.has(identity) || Number(lot.net_weight_kg) <= 0 || Number(lot.width_mm) <= 0) throw new Error(`Line ${index + 1}: each lot needs a unique vendor number, measured kg and width.`)
        seen.add(identity)
      })
      return {
        ...(mode === "PO" ? { po_line_id: line.po_line_id } : { item_id: line.item_id, incoming_qc_required: true }),
        quantity: isReel(line) ? undefined : Number(line.quantity), invoice_quantity: invoice.pending ? undefined : Number(line.invoice_quantity || quantity(line)),
        invoice_rate: invoice.pending ? undefined : Number(line.invoice_rate), batch_no: isReel(line) ? undefined : line.batch_no || undefined,
        lots: isReel(line) ? line.lots.map(({ key, ...lot }) => ({ ...lot, net_weight_kg: Number(lot.net_weight_kg), width_mm: Number(lot.width_mm), gross_weight_kg: lot.gross_weight_kg ? Number(lot.gross_weight_kg) : undefined, tare_weight_kg: lot.tare_weight_kg ? Number(lot.tare_weight_kg) : undefined })) : [],
      }
    })
    const body = { ...(mode === "PO" ? { purchase_order_id: poId } : { supplier_id: vendorId, supplier_name: vendor.name, reason: invoice.reason }), received_date: businessDate(), invoice_pending: invoice.pending, invoice_no: invoice.pending ? undefined : invoice.invoice_no, invoice_date: invoice.pending ? undefined : invoice.invoice_date, currency: "INR", lines: receivedLines }
    const fingerprint = JSON.stringify(body)
    if (!request.current || request.current.fingerprint !== fingerprint) request.current = { key: crypto.randomUUID(), fingerprint }
    return { ...body, request_id: request.current.key }
  }
  const validate = useMutation({ mutationFn: (body: any) => mode === "PO" ? purchaseApi.previewReceipt(body) : purchaseApi.previewManualReceipt(body), onSuccess: ({ data }, body) => { setPreview(data); setReviewedPayload(body); setNotice(null) }, onError: (error) => setNotice({ tone: "error", text: errorText(error) }) })
  const post = useMutation({ mutationFn: () => { if (!reviewedPayload || JSON.stringify(payload()) !== JSON.stringify(reviewedPayload)) throw new Error("Receipt details changed. Validate them again before posting."); return mode === "PO" ? purchaseApi.createReceipt(reviewedPayload) : purchaseApi.createManualReceipt(reviewedPayload) }, onSuccess: ({ data }) => { setPosted(data); setNotice({ tone: "success", text: `${data.grn_no} saved. ${data.lot_count} individual lots recorded. ${data.commercial_status === "CLEAR" ? "Commercial rates matched." : "Stock is held pending commercial approval."}` }); client.invalidateQueries({ queryKey: ["purchase-v2"] }) }, onError: (error) => setNotice({ tone: "error", text: errorText(error) }) })
  const busy = post.isPending || validate.isPending

  return <RoleGate allow={["Store", "PlantManager"]}><ProcurementShell eyebrow="Stores / goods inward" title="Receive materials" description="Choose the vendor and receipt source, then enter each material and its actual weighed reels or coils." actions={<Link className={secondaryButton} href="/purchase/receipts">GRN register <ArrowRight className="h-4 w-4" /></Link>}>
    {notice ? <MessageBar tone={notice.tone}>{notice.text}</MessageBar> : null}
    {receivable.isError || vendorsQuery.isError || itemsQuery.isError ? <MessageBar tone="error">Receipt masters could not load. Refresh before entering stock.</MessageBar> : null}
    {posted ? <><WorkPanel title="Receipt saved" description="Every physical unit has its own permanent AT identity. Open the register for approvals, invoice attachment, QC and later reprints." action={<button className={primaryButton} onClick={() => { reset(); setInvoice({ invoice_no: "", invoice_date: businessDate(), pending: false, reason: "" }) }}>Start next receipt</button>}><div className="flex flex-wrap gap-3"><Link className={secondaryButton} href={`/purchase/receipts/${posted.id}`}>Open saved receipt</Link>{posted.lot_count > 0 ? <LabelPrintControls lots={posted.lots || posted.created_lots || []} /> : null}</div></WorkPanel><LotLabels lots={posted.lots || posted.created_lots || []} /></> : <>
    <fieldset disabled={busy} className="contents">
    <WorkPanel title="Vendor & receipt source">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4"><Field label="Receipt source"><select className={fieldClass} value={mode} onChange={(event) => { setMode(event.target.value as typeof mode); reset() }}><option value="PO">Against approved system PO</option><option value="MANUAL">Manual GRN · without PO</option></select></Field><Field label="Vendor"><select className={fieldClass} value={vendorId} onChange={(event) => { setVendorId(event.target.value); setPoId(""); reset() }}><option value="">Select vendor</option>{vendors.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></Field>{mode === "PO" ? <Field label="Approved purchase order"><select className={fieldClass} value={poId} disabled={!vendorId} onChange={(event) => { setPoId(event.target.value); reset() }}><option value="">Select approved PO</option>{poOptions.map((row) => <option key={row.po_id} value={row.po_id}>{row.po_no} · revision {row.revision_no}</option>)}</select></Field> : <Field label="Reason for no PO"><input className={fieldClass} value={invoice.reason} onChange={(event) => setInvoice({ ...invoice, reason: event.target.value })} placeholder="e.g. approved urgent local purchase" /></Field>}<Field label="Inward date · automatic"><input className={fieldClass} disabled value={businessDate()} /></Field></div>
      {mode === "MANUAL" ? <p className="mt-3 text-sm text-signal-amber-ink">Manual stock requires invoice and independent approval. QC clearance remains a separate step.</p> : vendorId && !poOptions.length && !receivable.isLoading ? <p className="mt-3 text-sm text-signal-amber-ink">No approved open PO for this vendor. Complete PO approval or choose Manual GRN.</p> : null}
    </WorkPanel>
    <WorkPanel title="Supplier invoice"><div className="grid gap-4 md:grid-cols-3"><Field label="Invoice number"><input className={fieldClass} disabled={invoice.pending} value={invoice.invoice_no} onChange={(event) => setInvoice({ ...invoice, invoice_no: event.target.value })} /></Field><Field label="Invoice date"><input className={fieldClass} type="date" disabled={invoice.pending} value={invoice.invoice_date} onChange={(event) => setInvoice({ ...invoice, invoice_date: event.target.value })} /></Field><label className="flex min-h-11 items-center gap-3 self-end text-sm"><input type="checkbox" checked={invoice.pending} onChange={(event) => setInvoice({ ...invoice, pending: event.target.checked })} /> Challan received · invoice pending</label></div></WorkPanel>
    {lines.map((line, index) => { const selected: any = material(line); const reel = isReel(line); const qty = quantity(line); const delta = selected?.approved_rate != null && line.invoice_rate !== "" ? Number(line.invoice_rate) - selected.approved_rate : 0
      return <WorkPanel key={line.key} title={`Material ${index + 1}`} description={selected ? `${selected.item_code} · ${selected.item_name || selected.name}${mode === "PO" ? ` · ${selected.open_qty.toLocaleString("en-IN")} ${selected.uom} open` : ""}` : "Choose the exact variety before entering physical units."} action={<button className={secondaryButton} disabled={lines.length === 1} onClick={() => setLines(lines.filter((row) => row.key !== line.key))}><Trash2 className="h-4 w-4" /> Remove material</button>}>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"><Field label={mode === "PO" ? "PO material / variety" : "Material / variety"}><select className={fieldClass} value={mode === "PO" ? line.po_line_id : line.item_id} onChange={(event) => { const value = event.target.value; const chosen: any = mode === "PO" ? poLines.find((row) => row.po_line_id === value) : items.find((row) => String(row.id) === value); updateLine(line.key, { ...newLine(), key: line.key, po_line_id: mode === "PO" ? value : "", item_id: mode === "MANUAL" ? value : chosen?.item_id || "", invoice_rate: chosen?.approved_rate != null ? String(chosen.approved_rate) : "" }) }}><option value="">Select material</option>{(mode === "PO" ? poLines.filter((row) => row.po_line_id === line.po_line_id || !lines.some((candidate) => candidate.po_line_id === row.po_line_id)) : items).map((row: any) => <option key={row.po_line_id || row.id} value={row.po_line_id || row.id}>{row.item_code} · {row.item_name || row.name}</option>)}</select></Field>{mode === "PO" ? <Field label="Approved rate · locked"><input className={fieldClass} readOnly value={selected?.approved_rate ?? ""} /></Field> : null}<Field label={`Invoice rate / ${selected?.uom || "kg"}`}><input className={fieldClass} type="number" min="0" step="0.0001" disabled={invoice.pending} value={line.invoice_rate} onChange={(event) => updateLine(line.key, { invoice_rate: event.target.value })} /></Field><Field label="Invoice quantity" hint="Defaults to measured receipt"><input className={fieldClass} type="number" min="0.001" step="0.001" disabled={invoice.pending} placeholder={String(qty || "")} value={line.invoice_quantity} onChange={(event) => updateLine(line.key, { invoice_quantity: event.target.value })} /></Field></div>
        {delta !== 0 && !invoice.pending ? <p className="mt-3 rounded-lg bg-signal-amber-soft p-3 text-sm text-signal-amber-ink">Invoice rate differs by ₹{delta.toFixed(4)} per unit (₹{(qty * delta).toFixed(2)} for this receipt). A review case opens automatically; the approved PO stays unchanged.</p> : null}
        {selected && reel ? <div className="mt-5 space-y-3"><div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground"><strong className="text-foreground">{line.lots.length} physical units · {qty.toLocaleString("en-IN")} kg</strong> · Tab moves fields. Enter advances; Enter in the last field adds the next lot.</p><button className={secondaryButton} onClick={() => addLot(line)}><Plus className="h-4 w-4" /> Add reel / coil</button></div><div className="overflow-x-auto rounded-lg border border-border"><table className="w-full min-w-[920px] text-sm"><thead className="bg-muted text-left text-xs text-muted-foreground"><tr>{["#", "Vendor reel / coil no.", "Net kg", "Width mm", "Form", "Gross kg", "Tare kg", "Vendor batch", ""].map((head, i) => <th className="px-2 py-3 font-semibold" key={i}>{head}</th>)}</tr></thead><tbody onKeyDown={(event) => fastEntry(event, line)}>{line.lots.map((lot, lotIndex) => <tr key={lot.key} className="border-t border-border"><td className="px-2 tabular-nums text-muted-foreground">{lotIndex + 1}</td>{(["source_reel_no", "net_weight_kg", "width_mm"] as const).map((key) => <td className="p-1" key={key}><input id={key === "source_reel_no" ? `vendor-lot-${lot.key}` : undefined} aria-label={`Material ${index + 1} lot ${lotIndex + 1} ${key}`} className={`${fieldClass} ${key === "source_reel_no" ? "min-w-40" : "min-w-24"}`} type={key === "source_reel_no" ? "text" : "number"} min="0.001" step="0.001" value={lot[key]} onChange={(event) => updateLot(line, lot.key, { [key]: event.target.value })} /></td>)}<td className="p-1"><select aria-label={`Lot ${lotIndex + 1} form`} className={fieldClass} value={lot.physical_form} onChange={(event) => updateLot(line, lot.key, { physical_form: event.target.value as Lot["physical_form"] })}><option value="REEL">Reel</option><option value="COIL">Coil</option></select></td>{(["gross_weight_kg", "tare_weight_kg", "vendor_batch_no"] as const).map((key) => <td className="p-1" key={key}><input aria-label={`Material ${index + 1} lot ${lotIndex + 1} ${key}`} className={`${fieldClass} min-w-24`} type={key === "vendor_batch_no" ? "text" : "number"} min="0" step="0.001" value={lot[key]} onChange={(event) => updateLot(line, lot.key, { [key]: event.target.value })} /></td>)}<td className="p-1"><button aria-label={`Remove lot ${lotIndex + 1}`} className="flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-signal-rose-soft hover:text-signal-rose-ink disabled:opacity-30" disabled={line.lots.length === 1} onClick={() => updateLine(line.key, { lots: line.lots.filter((candidate) => candidate.key !== lot.key) })}><Trash2 className="h-4 w-4" /></button></td></tr>)}</tbody></table></div><details className="rounded-lg bg-muted p-3"><summary className="cursor-pointer text-sm font-medium text-signal-cyan-ink">Paste measured lot rows from Excel</summary><p className="my-2 text-xs text-muted-foreground">Columns: vendor number, net kg, width mm, REEL/COIL, gross kg, tare kg, vendor batch. Rows append to your existing entries.</p><textarea className={`${fieldClass} h-24 py-2 font-mono text-xs`} value={paste[line.key] || ""} onChange={(event) => setPaste({ ...paste, [line.key]: event.target.value })} /><button className={`${secondaryButton} mt-2`} onClick={() => pasteLots(line)}>Append pasted lots</button></details></div> : selected ? <div className="mt-4 grid gap-3 md:grid-cols-2"><Field label={`Received quantity · ${selected.uom || "KG"}`}><input className={fieldClass} type="number" min="0.001" step="0.001" value={line.quantity} onChange={(event) => updateLine(line.key, { quantity: event.target.value })} /></Field><Field label="Batch number · optional"><input className={fieldClass} value={line.batch_no} onChange={(event) => updateLine(line.key, { batch_no: event.target.value })} /></Field></div> : null}
      </WorkPanel> })}
    <button className={secondaryButton} disabled={!vendorId || (mode === "PO" && !poId)} onClick={() => setLines([...lines, newLine()])}><Plus className="h-4 w-4" /> Add another material</button>
    {preview ? <WorkPanel title="Validation result"><div className="space-y-2">{preview.lines.map((row: any, i: number) => <p key={i} className="text-sm"><strong>{row.item_code}</strong> · {row.quantity_kg.toLocaleString("en-IN")} {row.uom || "KG"} · {row.physical_unit_count} lots · {row.commercial_status || preview.commercial_status}</p>)}</div></WorkPanel> : null}
    <div className="sticky bottom-3 z-20 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card/95 p-4 shadow-lg backdrop-blur"><div><p className="font-semibold tabular-nums text-foreground">{lines.length} materials · {lotCount} reels / coils · {quantitySummary} received</p><p className="mt-1 text-xs text-muted-foreground">Invoice value {invoice.pending ? "pending" : `₹${totalValue.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`} · Each physical unit gets one QR label</p></div><div className="flex gap-2"><button className={secondaryButton} disabled={busy} onClick={() => { try { validate.mutate(payload()) } catch (error) { setNotice({ tone: "error", text: errorText(error) }) } }}>Validate receipt</button><button className={primaryButton} disabled={busy || !reviewedPayload || !vendorId || total <= 0} onClick={() => post.mutate()}><PackageCheck className="h-4 w-4" />{post.isPending ? "Posting…" : "Post goods inward"}</button></div></div>
    </fieldset></>}
  </ProcurementShell></RoleGate>
}
