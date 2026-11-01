function toNumber(value: unknown): number {
  const numeric = Number(value ?? 0)
  return Number.isFinite(numeric) ? numeric : 0
}

export function buildDispatchDocumentData({
  jobCard,
  dispatchRecord,
  customers,
  plants,
}: {
  jobCard: any
  dispatchRecord?: any
  customers?: any[]
  plants?: any[]
}) {
  const customerRows = Array.isArray(customers) ? customers : []
  const plantRows = Array.isArray(plants) ? plants : []
  const customer =
    customerRows.find((row) => String(row.id) === String(jobCard?.customer_id || dispatchRecord?.customer_id || "")) ||
    dispatchRecord?.customer ||
    jobCard?.customer ||
    null
  const plant =
    plantRows.find((row) => String(row.id) === String(jobCard?.plant_id || dispatchRecord?.plant_id || "")) ||
    dispatchRecord?.plant ||
    null

  const packing = jobCard?.packing_record || {}
  const summary = {
    total_units: toNumber(dispatchRecord?.dispatch_snapshot?.summary?.total_units || packing?.bundle_count || 0),
    total_pcs: toNumber(dispatchRecord?.dispatch_snapshot?.summary?.total_pcs || packing?.total_pcs || jobCard?.released_qty || 0),
    total_weight: toNumber(
      dispatchRecord?.dispatch_snapshot?.summary?.total_weight ||
        packing?.packed_weight_kg ||
        packing?.net_weight_kg ||
        0,
    ),
  }

  const itemDescription =
    dispatchRecord?.dispatch_snapshot?.items?.[0]?.description ||
    [jobCard?.product_code, jobCard?.size_label, jobCard?.parchment_color].filter(Boolean).join(" · ") ||
    jobCard?.job_card_ref ||
    jobCard?.job_card_no ||
    "Dispatch line"

  const items = dispatchRecord?.dispatch_snapshot?.items || [
    {
      description: itemDescription,
      qty_units: summary.total_units,
      total_pcs: summary.total_pcs,
      net_weight: summary.total_weight,
    },
  ]

  return {
    dispatch_request_id: dispatchRecord?.dispatch_request_id || dispatchRecord?.dispatch_snapshot?.dispatch_request_id || null,
    fg_item_id: dispatchRecord?.fg_item_id || packing?.fg_item_id || null,
    fg_batch_id: dispatchRecord?.fg_batch_id || dispatchRecord?.dispatch_snapshot?.fg_batch_id || null,
    job_card_id: jobCard?.id,
    job_card_no: jobCard?.job_card_no || jobCard?.job_card_ref || jobCard?.id,
    customer,
    plant,
    summary,
    sales_order_line_id: jobCard?.sales_order_line_id || null,
    items,
    dispatch_snapshot: dispatchRecord?.dispatch_snapshot || null,
  }
}

export type ChallanBoxRow = { id?: string; code: string; qty: number; part: boolean; flagged: boolean }
export type ChallanBoxView = {
  packingLabel: string
  units: number
  perUnit: number | null
  /** The goods line's PCS/Unit cell: "45", or "45 (part box 30)" when a part box ships, so units × pcs reads right. */
  perUnitText: string
  totalPcs: number
  boxes: ChallanBoxRow[]
  packing: {
    box: string
    qtyPerBox: number | null
    plastic: string
    fadda: string
    line: string
  }
}

const textOf = (value: unknown) => String(value ?? "").trim()

/** "Box R-150" from the spec's box code ("R-150"); a code that already says "box" is kept as it is. */
export function boxPackingLabel(code: unknown): string {
  const text = textOf(code)
  if (!text) return "Box"
  return /^box\b/i.test(text) ? text : `Box ${text}`
}

/** "2 × PL-01" / "2" / "" — material per box from the spec. */
function perBox(count: unknown, sku: unknown): string {
  const n = Number(count)
  const code = textOf(sku)
  if (!(n > 0)) return code ? `${code} (count not in the spec)` : ""
  return code ? `${n.toLocaleString("en-IN")} × ${code}` : n.toLocaleString("en-IN")
}

/** "4 boxes × 30 + part box 10 = 130 pcs" for the challan packing block. */
export function challanBoxLine(boxes: ChallanBoxRow[]): string {
  if (!boxes.length) return "No boxes"
  const full = boxes.filter((box) => !box.part)
  const parts = boxes.filter((box) => box.part)
  const sizes = Array.from(new Set(full.map((box) => box.qty)))
  const total = boxes.reduce((sum, box) => sum + box.qty, 0)
  const head = full.length ? (sizes.length === 1 ? `${full.length} box${full.length === 1 ? "" : "es"} × ${sizes[0].toLocaleString("en-IN")}` : `${full.length} full boxes`) : ""
  const tail = parts.map((box) => `part box ${box.qty.toLocaleString("en-IN")}`).join(" + ")
  return `${[head, tail].filter(Boolean).join(" + ")} = ${total.toLocaleString("en-IN")} pcs`
}

/**
 * PCS/Unit for the goods line (verification issue #6): "45" when every box is full; with part boxes the full size
 * plus each part box, "45 (part box 30)" / "45 (part boxes 30, 5)", or "part box 30" when only a part box ships.
 * Several full sizes read "30 / 45". Matches the boxes block below the table (challanBoxLine).
 */
export function challanPerUnitText(boxes: ChallanBoxRow[], perUnit: number | null): string {
  const n = (value: number) => value.toLocaleString("en-IN")
  const sizes = Array.from(new Set(boxes.filter((box) => !box.part).map((box) => box.qty))).sort((a, b) => b - a)
  const parts = boxes.filter((box) => box.part).map((box) => box.qty)
  const full = sizes.map(n).join(" / ")
  const part = parts.length ? `part box${parts.length === 1 ? "" : "es"} ${parts.map(n).join(", ")}` : ""
  if (!full) return part || (perUnit ? n(perUnit) : "—")
  return part ? `${full} (${part})` : full
}

/**
 * The challan's box view when the snapshot carries boxes (box cards, owner decision 1 Nov 2026): the goods row's
 * packing / units / pcs per unit / total, every box with its pcs, and the packing block from the spec.
 * Returns null for an old quantity challan, which renders exactly as before.
 */
export function challanBoxView(snapshot: any): ChallanBoxView | null {
  const raw = Array.isArray(snapshot?.boxes) ? snapshot.boxes : null
  if (!raw || !raw.length) return null
  const boxes: ChallanBoxRow[] = raw.map((box: any) => ({
    id: box?.id ? String(box.id) : undefined,
    code: textOf(box?.box_code || box?.code),
    qty: toNumber(box?.qty),
    part: Boolean(box?.is_part ?? box?.part),
    flagged: Boolean(box?.qc_flagged ?? box?.flagged),
  }))
  const packing = snapshot?.box_packing || {}
  const fullSizes = boxes.filter((box) => !box.part).map((box) => box.qty)
  const specQty = Number(packing.qty_per_box)
  const perUnit = specQty > 0 ? specQty : fullSizes.length ? Math.max(...fullSizes) : null
  const size = textOf(packing.box_size)
  return {
    packingLabel: boxPackingLabel(packing.box_code),
    units: boxes.length,
    perUnit,
    perUnitText: challanPerUnitText(boxes, perUnit),
    totalPcs: boxes.reduce((sum, box) => sum + box.qty, 0),
    boxes,
    packing: {
      box: [textOf(packing.box_code) || "Not in the spec", size].filter(Boolean).join(" · "),
      qtyPerBox: perUnit,
      plastic: perBox(packing.plastic_per_box, packing.plastic_sku),
      fadda: perBox(packing.fadda_per_box, packing.fadda_sku),
      line: challanBoxLine(boxes),
    },
  }
}

/** The packing block the server writes at sealing, built on the page so the preview shows the same thing. */
export function previewBoxPacking(specPacking: any, boxes: { qty: number; is_part: boolean }[]) {
  const sp = specPacking || {}
  return {
    box_code: sp.box_code ?? null,
    box_size: sp.box_size ?? null,
    qty_per_box: sp.qty_per_box ?? null,
    plastic_sku: sp.plastic_sku ?? null,
    plastic_per_box: sp.plastic_per_box ?? null,
    fadda_sku: sp.fadda_sku ?? null,
    fadda_per_box: sp.fadda_per_box ?? null,
    box_count: boxes.length,
    full_boxes: boxes.filter((box) => !box.is_part).length,
    part_boxes: boxes.filter((box) => box.is_part).length,
    total_pcs: boxes.reduce((sum, box) => sum + (Number(box.qty) || 0), 0),
  }
}
