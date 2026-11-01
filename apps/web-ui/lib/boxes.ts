/**
 * Boxes (owner decision 2, 1 Nov 2026): Process good pcs are packed into boxes of the spec's qty per box;
 * the remainder at Process close is a part box. The box is the dispatch unit: every box has a code
 * (e.g. B261014-001), a QR label that opens /production/boxes/<code>, and is posted to stock on its own.
 */
import { api } from "./api"

export type Box = {
  id: string
  job_card_id: string
  seq_no: number
  box_code: string
  qty: number
  qty_per_box: number | null
  is_part: boolean
  box_master_code: string | null
  status: "PACKED" | "DISPATCHED" | "RETAINED" | "VOID"
  business_date: string | null
  shift_code: string | null
  operator_name: string | null
  qc_flagged: boolean
  qc_flags: { label?: string; parameter?: string; value?: number; min?: number; max?: number; entry_no?: number }[]
  packaging: { lines?: { kind: string; code: string; pcs: number; unit_weight_kg?: number | null }[]; warnings?: string[] }
  fg_status: "PENDING" | "POSTED" | "FAILED"
  dispatch_id: string | null
  dispatched_at: string | null
  label_prints: number
  packed_at: string | null
  challan_no?: string | null
  // Label fields (box page / labels)
  job_card_no?: string | null
  customer?: string | null
  product_code?: string | null
  spec_reference?: string | null
  size_label?: string | null
  colour?: string | null
  sales_order_no?: string | null
  customer_po?: string | null
  sales_order_id?: string | null
  plant_id?: string | null
  // Box page (by-code): the runs packed in the box, the challan it left on and the card's box totals
  allocations?: { entry_id?: string; entry_no?: number | null; pcs: number }[]
  challan_date?: string | null
  card_summary?: BoxSummary | null
  last_printed_at?: string | null
}

export type BoxSummary = {
  box_mode: boolean
  qty_per_box: number | null
  box_count: number
  boxed_pcs: number
  packed_boxes: number
  packed_pcs: number
  ready_boxes: number
  ready_pcs: number
  dispatched_boxes: number
  dispatched_pcs: number
  retained_boxes: number
  retained_pcs: number
  part_boxes: number
  flagged_boxes: number
  fg_failed_boxes: number
}

export const boxesApi = {
  cardBoxes: (cardId: string) => api.get(`/api/production/job-cards/${cardId}/boxes`),
  byCode: (code: string) => api.get(`/api/production/boxes/by-code/${encodeURIComponent(code)}`),
  labels: (params: { job_card_id?: string; codes?: string }) => api.get("/api/production/boxes/labels", { params }),
  printed: (boxIds: string[]) => api.post("/api/production/boxes/labels/printed", { box_ids: boxIds }),
}

const BOX_CODE = /^B[A-Z0-9]{2,40}-\d{3,}$/
const BOX_PATH = /\/production\/boxes\/([A-Za-z0-9-]+)(?:[/?#]|$)/

/** A box code from a scan or typed text: the bare code (B261014-001) or the box page link on the label. */
export function boxCodeFrom(value: string | null | undefined): string | null {
  const raw = String(value ?? "").trim()
  if (!raw) return null
  const path = raw.match(BOX_PATH)
  if (path && BOX_CODE.test(path[1].toUpperCase())) return path[1].toUpperCase()
  const upper = raw.toUpperCase()
  return BOX_CODE.test(upper) ? upper : null
}

/** Letters and digits of a box code, upper case ("b261014 001" -> "B261014001"); "" when it cannot be a box code. */
export function compactBoxCode(value: string | null | undefined): string {
  const compact = String(value ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase()
  return /^B[A-Z0-9]*\d{3}$/.test(compact) && compact.length >= 5 ? compact : ""
}

/** The link printed in a box label's QR code. */
export function boxPageUrl(code: string, origin = typeof window !== "undefined" ? window.location.origin : "") {
  return `${origin}/production/boxes/${encodeURIComponent(code)}`
}

/** "3 boxes × 30 + part box 10 = 100 pcs" */
export function boxesText(boxes: Pick<Box, "qty" | "is_part">[]): string {
  if (!boxes.length) return "No boxes"
  const full = boxes.filter((b) => !b.is_part)
  const parts = boxes.filter((b) => b.is_part)
  const sizes = Array.from(new Set(full.map((b) => b.qty)))
  const total = boxes.reduce((sum, b) => sum + b.qty, 0)
  const head = full.length ? (sizes.length === 1 ? `${full.length} box${full.length === 1 ? "" : "es"} × ${sizes[0]}` : `${full.length} boxes`) : ""
  const tail = parts.map((b) => `part box ${b.qty}`).join(" + ")
  return `${[head, tail].filter(Boolean).join(" + ")} = ${total.toLocaleString("en-IN")} pcs`
}

export const boxStatusLabel: Record<string, string> = { PACKED: "Packed", DISPATCHED: "Dispatched", RETAINED: "Kept as surplus", VOID: "Void" }

export function shiftShort(shift: string | null | undefined) {
  return shift === "SHIFT_A" ? "Shift A" : shift === "SHIFT_B" ? "Shift B" : shift || ""
}

/** Box label sizes: A4 2 × 4 (8 a page), A4 3 × 7 (21 a page, compact) and one 100 × 75 mm label a page. */
export type BoxLabelSize = "a4-8" | "a4-21" | "single"
export const BOX_LABEL_SIZES: { value: BoxLabelSize; label: string; perPage: number }[] = [
  { value: "a4-8", label: "A4 · 8 a sheet", perPage: 8 },
  { value: "a4-21", label: "A4 · 21 a sheet (small)", perPage: 21 },
  { value: "single", label: "Single label 100 × 75 mm", perPage: 1 },
]

export function boxLabelSize(value: string | null | undefined): BoxLabelSize {
  return BOX_LABEL_SIZES.some((size) => size.value === value) ? (value as BoxLabelSize) : "a4-8"
}

/** Labels split into printed pages of the size's labels per page. */
export function boxLabelPages<T>(labels: T[], size: BoxLabelSize): T[][] {
  const perPage = BOX_LABEL_SIZES.find((row) => row.value === size)?.perPage || 8
  const pages: T[][] = []
  for (let i = 0; i < labels.length; i += perPage) pages.push(labels.slice(i, i + perPage))
  return pages
}

/** "01 Nov 2026" from a business date (YYYY-MM-DD) or a timestamp; "" when there is none. */
export function boxDayText(value: string | null | undefined): string {
  const match = String(value ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return ""
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(match[2]) - 1]
  return month ? `${match[3]} ${month} ${match[1]}` : ""
}

/** Stock posting of a box in plain words. */
export const boxStockLabel: Record<Box["fg_status"], string> = { POSTED: "In stock", PENDING: "Posting…", FAILED: "Posting failed — retried automatically" }

/** The pcs line on a label: "30 pcs" or "10 pcs · PART BOX". */
export function boxPcsText(box: Pick<Box, "qty" | "is_part">): string {
  return `${Number(box.qty || 0).toLocaleString("en-IN")} pcs${box.is_part ? " · PART BOX" : ""}`
}

// ── Challan helpers (dispatch picker, 1 Nov 2026) ────────────────────────────────────────────────────

type PickableBox = Pick<Box, "id" | "box_code" | "qty" | "is_part" | "status" | "fg_status" | "qc_flagged" | "seq_no"> & { challan_no?: string | null }

/** A box can go on a challan only when it is packed (not shipped / kept / void) and posted to stock. */
export function boxReady(box: Pick<Box, "status" | "fg_status">): boolean {
  return box.status === "PACKED" && box.fg_status === "POSTED"
}

/** Where a box stands for dispatch, in plain words. */
export function boxStateText(box: Pick<Box, "status" | "fg_status"> & { challan_no?: string | null }): string {
  if (box.status === "DISPATCHED") return box.challan_no ? `Shipped on ${box.challan_no}` : "Shipped"
  if (box.status === "RETAINED") return "Kept as surplus"
  if (box.status === "VOID") return "Void"
  if (box.fg_status === "POSTED") return "In stock"
  if (box.fg_status === "FAILED") return "Stock posting failed"
  return "Waiting for stock posting"
}

/** Ticked boxes in box order, with their totals and the "3 boxes × 30 + part box 10 = 100 pcs" line. */
export function boxSelectionTotals<T extends PickableBox>(boxes: T[], selectedIds: string[]) {
  const wanted = new Set(selectedIds)
  const picked = boxes.filter((box) => wanted.has(box.id)).sort((a, b) => (a.seq_no ?? 0) - (b.seq_no ?? 0))
  return {
    boxes: picked,
    count: picked.length,
    pcs: picked.reduce((sum, box) => sum + (Number(box.qty) || 0), 0),
    full: picked.filter((box) => !box.is_part).length,
    part: picked.filter((box) => box.is_part).length,
    flagged: picked.filter((box) => box.qc_flagged).length,
    text: boxesText(picked),
  }
}

/**
 * "Select all ready": every ready box in box order that still fits in the pcs that may ship now (a box cannot be
 * split). `left_out` counts ready boxes that did not fit.
 */
export function selectReadyWithin<T extends PickableBox>(boxes: T[], limitPcs: number) {
  const ids: string[] = []
  let pcs = 0
  let leftOut = 0
  for (const box of [...boxes].sort((a, b) => (a.seq_no ?? 0) - (b.seq_no ?? 0))) {
    if (!boxReady(box)) continue
    const qty = Number(box.qty) || 0
    if (pcs + qty <= limitPcs + 0.0001) {
      ids.push(box.id)
      pcs += qty
    } else leftOut += 1
  }
  return { ids, pcs, left_out: leftOut }
}

export type BoxPick<T> = { ok: boolean; box?: T; added: boolean; message: string }

/** A scanned / typed box code (or label link) checked against this card's boxes and the boxes already ticked. */
export function pickBox<T extends PickableBox>(boxes: T[], scanned: string, selectedIds: string[]): BoxPick<T> {
  // Typed without the dash or with spaces (b261014001): the one box of this card with those letters and digits.
  const loose = compactBoxCode(scanned)
  const looseHits = loose ? boxes.filter((row) => compactBoxCode(row.box_code) === loose) : []
  const code = boxCodeFrom(scanned) || (looseHits.length === 1 ? String(looseHits[0].box_code).toUpperCase() : null)
  if (!code) return { ok: false, added: false, message: "That is not a box code. Scan the box label or type a code like B261014-001." }
  const box = boxes.find((row) => String(row.box_code).toUpperCase() === code)
  if (!box) return { ok: false, added: false, message: `Box ${code} is not on this job card.` }
  if (box.status === "DISPATCHED") return { ok: false, box, added: false, message: `Box ${code} is already shipped${box.challan_no ? ` on challan ${box.challan_no}` : ""}.` }
  if (box.status === "RETAINED") return { ok: false, box, added: false, message: `Box ${code} is kept as surplus and cannot ship.` }
  if (box.status === "VOID") return { ok: false, box, added: false, message: `Box ${code} is void and cannot ship.` }
  if (box.fg_status !== "POSTED") {
    return { ok: false, box, added: false, message: `Box ${code} is not in stock yet (${box.fg_status === "FAILED" ? "the stock posting failed" : "waiting for the stock posting"}).` }
  }
  if (selectedIds.includes(box.id)) return { ok: true, box, added: false, message: `Box ${code} is already ticked.` }
  return { ok: true, box, added: true, message: `Box ${code} ticked: ${Number(box.qty).toLocaleString("en-IN")} pcs${box.is_part ? " (part box)" : ""}.` }
}
