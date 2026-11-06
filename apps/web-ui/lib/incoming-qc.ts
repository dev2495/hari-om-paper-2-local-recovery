import { qcExceptionFeedback, qcInputKind, type QcParameterRule } from "./qc-measurement"

export type IncomingDecision = "AUTO" | "HOLD" | "REJECT"

export type IncomingEntry = {
  readings: Record<string, string>
  decision: IncomingDecision
  /** INCOMING_QC code from Masters › Reason codes (owner decision 4); `reason` is its note, or a plain note when no reason is needed. */
  reasonCode: string
  reason: string
  closeHolds: boolean
}

export type IncomingPreviewKind = "blank" | "release" | "fail" | "incomplete" | "hold" | "reject" | "held_by_hold"

export type IncomingPreview = {
  kind: IncomingPreviewKind
  /** Short words for a chip: "Releases", "Fails GSM", "Missing 2". */
  label: string
  /** One sentence for the row / summary. */
  text: string
  failing: string[]
  missing: string[]
  /** True when this lot is saved (something entered or a decision taken). */
  willSave: boolean
  /** Reason/note must be written before saving. */
  needsReason: boolean
}

export const EMPTY_ENTRY: IncomingEntry = { readings: {}, decision: "AUTO", reasonCode: "", reason: "", closeHolds: true }

/** Mirrors hariom_quality_eval DENIED_CATEGORICAL_TOKENS: a choice that means the check failed. */
const DENIED_CHOICES = new Set(["FAIL", "FAILED", "REJECT", "REJECTED", "HOLD", "NO", "NG", "NOT_OK", "NOTOK"])

export function applicableRules(rules: QcParameterRule[] | null | undefined) {
  return (Array.isArray(rules) ? rules : []).filter((rule) => rule && rule.code && rule.applicable !== false)
}

const filled = (value: unknown) => value != null && String(value).trim() !== ""

export function entryHasInput(entry: IncomingEntry | undefined) {
  return Boolean(entry && (Object.values(entry.readings).some(filled) || entry.decision !== "AUTO"))
}

/** Per-cell verdict while typing: PASS / FAIL / INVALID, or null when blank, a note, or record-only. */
export function cellVerdict(rule: QcParameterRule, raw: unknown): "PASS" | "FAIL" | "INVALID" | null {
  if (!filled(raw)) return null
  const kind = qcInputKind(rule)
  if (kind === "text") return null
  if (kind === "select") {
    const value = String(raw).trim()
    const options = (rule.options || []).map((option) => String(option).trim()).filter(Boolean)
    if (options.length && !options.includes(value)) return "INVALID"
    return DENIED_CHOICES.has(value.toUpperCase()) ? "FAIL" : "PASS"
  }
  if (rule.min == null && rule.max == null) {
    return qcExceptionFeedback(rule, raw)?.verdict === "INVALID" ? "INVALID" : null
  }
  return qcExceptionFeedback(rule, raw)?.verdict || null
}

/**
 * What the server will do with this lot when saved (inventory-service create_quality_inspection):
 * a required blank check is INCOMPLETE, a reading outside its band is FAIL, both keep the lot held;
 * a re-inspected lot is released only when its earlier inspection holds are closed with a note.
 */
export function previewIncomingLot(
  rules: QcParameterRule[],
  entry: IncomingEntry | undefined,
  options: { openHolds?: number } = {},
): IncomingPreview {
  const row = entry || EMPTY_ENTRY
  const checks = applicableRules(rules)
  const failing: string[] = []
  const missing: string[] = []
  for (const rule of checks) {
    const raw = row.readings[rule.code]
    if (!filled(raw)) {
      if (rule.required !== false) missing.push(rule.label || rule.code)
      continue
    }
    const verdict = cellVerdict(rule, raw)
    if (verdict === "FAIL" || verdict === "INVALID") failing.push(rule.label || rule.code)
  }
  const willSave = entryHasInput(row)
  const openHolds = options.openHolds || 0
  const base = { failing, missing, willSave }
  if (!willSave) return { ...base, kind: "blank", label: "Not entered", text: "Nothing entered — not saved.", needsReason: false }
  if (row.decision === "REJECT") return { ...base, kind: "reject", label: "Reject", text: "Rejected · stays out of issue until returned or conceded.", needsReason: true }
  if (row.decision === "HOLD") return { ...base, kind: "hold", label: "Hold", text: "Held for review · not issuable.", needsReason: true }
  if (failing.length) {
    return { ...base, kind: "fail", label: `Fails ${failing.join(", ")}`, text: `Fails ${failing.join(", ")} · stays held.`, needsReason: true }
  }
  if (missing.length) {
    return {
      ...base,
      kind: "incomplete",
      label: `Missing ${missing.length}`,
      text: `Missing ${missing.join(", ")} · saved as incomplete, stays held.`,
      needsReason: false,
    }
  }
  if (openHolds && !row.closeHolds) {
    return { ...base, kind: "held_by_hold", label: "Passes · hold stays", text: "Passes, but the earlier hold stays open · not issuable.", needsReason: false }
  }
  return {
    ...base,
    kind: "release",
    label: "Releases",
    text: openHolds ? "Passes · earlier hold closes · released for issue." : "Passes · released for issue.",
    needsReason: openHolds > 0,
  }
}

/** Readings as the API wants them: numbers for measured checks, words for notes and choices. */
export function incomingReadingsPayload(rules: QcParameterRule[], readings: Record<string, string>) {
  const byCode = new Map(applicableRules(rules).map((rule) => [rule.code, rule]))
  return Object.fromEntries(
    Object.entries(readings)
      .filter(([, value]) => filled(value))
      .map(([code, value]) => {
        const text = String(value).trim()
        const number = Number(text)
        return [code, qcInputKind(byCode.get(code)) === "number" && text !== "" && Number.isFinite(number) ? number : text]
      }),
  )
}

/**
 * The row's one reason explains every failing check of that lot (the API wants a reason per failed code). Only
 * sent with a reason code: the server writes "Label — note" against each failing check.
 */
export function incomingReasonsPayload(rules: QcParameterRule[], entry: IncomingEntry) {
  if (!entry.reasonCode) return {}
  const reason = entry.reason.trim() || entry.reasonCode
  return Object.fromEntries(
    applicableRules(rules)
      .filter((rule) => {
        const verdict = cellVerdict(rule, entry.readings[rule.code])
        return verdict === "FAIL" || verdict === "INVALID"
      })
      .map((rule) => [rule.code, reason]),
  )
}

/** Reason fields of one row's request: the INCOMING_QC code + note when a reason is needed, else the plain note. */
export function incomingReasonFields(entry: IncomingEntry, needsReason: boolean) {
  const note = entry.reason.trim()
  if (needsReason || entry.reasonCode) return { reason_code: entry.reasonCode || undefined, reason_note: note || undefined }
  return { notes: note || undefined }
}

export type IncomingQueueGroup = {
  key: string
  title: string
  grn: string
  supplier: string
  materialType: string
  lots: any[]
  qty: number
  uom: string
  overdue: boolean
  dueAt: string | null
  receivedDate: string | null
  poNo: string | null
  invoiceNo: string | null
  challanNo: string | null
}

export const lotKey = (row: any) => `${row?.entity_type}:${row?.entity_id}`

export function lotName(row: any) {
  return row?.unit_label || String(row?.label || "").split(" · ")[0] || "Lot"
}

export function lotItemName(row: any) {
  const parts = String(row?.label || "").split(" · ")
  return parts.length > 1 ? parts.slice(1).join(" · ") : parts[0] || "Material"
}

/** One group per inward line: all reels / coils / batches that came in together and share a standard. */
export function groupIncomingQueue(rows: any[]): IncomingQueueGroup[] {
  const groups = new Map<string, IncomingQueueGroup>()
  for (const row of rows) {
    const key = row?.receipt_line_id ? `line:${row.receipt_line_id}` : lotKey(row)
    let group = groups.get(key)
    if (!group) {
      group = {
        key,
        title: lotItemName(row),
        grn: row?.grn_no || "",
        supplier: row?.supplier_or_customer || "",
        materialType: String(row?.material_type || ""),
        lots: [],
        qty: 0,
        uom: row?.uom || "KG",
        overdue: false,
        dueAt: null,
        receivedDate: row?.received_date || null,
        poNo: row?.po_no || null,
        invoiceNo: row?.invoice_no || null,
        challanNo: row?.challan_no || null,
      }
      groups.set(key, group)
    }
    group.lots.push(row)
    group.qty += Number(row?.qty || 0)
    group.overdue = group.overdue || Boolean(row?.overdue)
    if (row?.due_at && (!group.dueAt || String(row.due_at) < group.dueAt)) group.dueAt = String(row.due_at)
  }
  return Array.from(groups.values()).sort((left, right) => {
    if (left.overdue !== right.overdue) return left.overdue ? -1 : 1
    return String(left.dueAt || "9999").localeCompare(String(right.dueAt || "9999"))
  })
}

export const MATERIAL_LABEL: Record<string, string> = {
  RAW_PAPER: "Paper reels",
  ADHESIVE: "Adhesive",
  PARCHMENT: "Parchment",
  PACKAGING: "Packing",
  PACKING: "Packing",
  CONSUMABLE: "Consumables",
  FINISHED_GOOD: "Finished goods",
}

export function materialLabel(value: string) {
  return MATERIAL_LABEL[String(value || "").toUpperCase()] || String(value || "Other").replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase())
}

// ── Incoming QC by bill (6 Nov 2026) ─────────────────────────────────────────────────────────────
// One card per bill (a GRN, or one supplier invoice across GRNs); every reel / lot of it in one grid.
// Stock stays on the bill weight: the actual weight only feeds the weight check of the bill.

export type BillTab = "TO_WEIGH" | "PART_DONE" | "OWNER_DECISION" | "DONE_TODAY" | "HELD"
export const BILL_TABS: Array<{ key: BillTab; label: string; hint: string }> = [
  { key: "TO_WEIGH", label: "To weigh", hint: "Nothing weighed yet" },
  { key: "PART_DONE", label: "Part done", hint: "Some lots still to weigh" },
  { key: "OWNER_DECISION", label: "Owner decision", hint: "Weight short: Owner decides" },
  { key: "DONE_TODAY", label: "Done today", hint: "Every lot weighed" },
  { key: "HELD", label: "Held", hint: "On hold or rejected" },
]

/** Above this share away from the bill weight, the desk asks "Check: 11,750 kg vs bill 1,182 kg". */
export const TYPO_GUARD_SHARE = 0.15

export type BillDecision = "ACCEPT" | "HOLD" | "REJECT"

export type BillRowEntry = {
  actual: string
  /** Set only when the person picked it (or Accept all weighed): otherwise Accept is the default. */
  decision: BillDecision | null
  readings: Record<string, string>
  reasonCode: string
  reasonNote: string
  note: string
  closeHolds: boolean
  confirmFar: boolean
}

export const EMPTY_BILL_ROW: BillRowEntry = { actual: "", decision: null, readings: {}, reasonCode: "", reasonNote: "", note: "", closeHolds: true, confirmFar: false }

export type BillLot = {
  key: string
  entity_type: "REEL" | "BATCH"
  entity_id: string
  code: string
  vendor_ref?: string | null
  item_name?: string | null
  uom: string
  bill_qty: number | null
  actual_qty: number | null
  queue_state: string
  stock_status: string
  rejected?: boolean
  can_enter?: boolean
  can_weigh?: boolean
  weight_required_for_accept?: boolean
  last_inspection?: { id: string; status: string; disposition?: string | null; failures?: string[]; readings?: Record<string, any>; reason_label?: string | null } | null
  inspection_holds?: Array<{ id: string; reason: string }>
  quality_profile?: { parameters?: QcParameterRule[] } | null
  [key: string]: any
}

export const parseQty = (value: unknown): number | null => {
  const text = String(value ?? "").replace(/,/g, "").trim()
  if (!text) return null
  const number = Number(text)
  return Number.isFinite(number) ? number : null
}

/** The weight that counts for a row: the one saved, else the one typed now. */
export function rowActual(lot: BillLot, entry?: BillRowEntry): number | null {
  if (lot.actual_qty != null) return Number(lot.actual_qty)
  return parseQty(entry?.actual)
}

/** Actual − bill (negative = short), or null until weighed. */
export function rowDiff(lot: BillLot, entry?: BillRowEntry): number | null {
  const actual = rowActual(lot, entry)
  if (actual == null || lot.bill_qty == null) return null
  return Math.round((actual - Number(lot.bill_qty)) * 1000) / 1000
}

/** "Check: 11,750 kg vs bill 1,182 kg" when the typed weight is more than 15 % away from the bill. */
export function typoWarning(actual: number | null, bill: number | null | undefined, uom = "KG"): string | null {
  if (actual == null || bill == null || Number(bill) <= 0) return null
  if (Math.abs(actual - Number(bill)) / Number(bill) <= TYPO_GUARD_SHARE) return null
  const unit = String(uom).toUpperCase() === "KG" ? "kg" : String(uom).toLowerCase()
  const fmt = (value: number) => value.toLocaleString("en-IN", { maximumFractionDigits: 3 })
  return `Check: ${fmt(actual)} ${unit} vs bill ${fmt(Number(bill))} ${unit}`
}

export function lotRules(lot: BillLot): QcParameterRule[] {
  return applicableRules(lot.quality_profile?.parameters).filter((rule) => !["reel_weight_kg", "weight_kg"].includes(rule.code))
}

/** Every check of the bill once, in order of first appearance (a bill is nearly always one material). */
export function billRules(lots: BillLot[]): QcParameterRule[] {
  const seen = new Map<string, QcParameterRule>()
  for (const lot of lots) for (const rule of lotRules(lot)) if (!seen.has(rule.code)) seen.set(rule.code, rule)
  return Array.from(seen.values())
}

export function failingChecks(lot: BillLot, entry?: BillRowEntry): string[] {
  if (!entry) return []
  return lotRules(lot)
    .filter((rule) => {
      const verdict = cellVerdict(rule, entry.readings[rule.code])
      return verdict === "FAIL" || verdict === "INVALID"
    })
    .map((rule) => rule.label || rule.code)
}

export type BillRowPlan = {
  /** Something to save on this row. */
  dirty: boolean
  /** What the server is asked: ACCEPT / HOLD / REJECT, or NONE (weight only, the lot keeps its decision). */
  decision: BillDecision | "NONE"
  needsReason: boolean
  /** Plain reason the row cannot be saved yet ("Weigh it first…"), else null. */
  problem: string | null
  typo: string | null
  failing: string[]
}

const hasReadings = (entry?: BillRowEntry) => Boolean(entry && Object.values(entry.readings).some((value) => String(value ?? "").trim() !== ""))

/** What saving this row would send, and whether it can be sent. */
export function planRow(lot: BillLot, entry?: BillRowEntry): BillRowPlan {
  const row = entry || EMPTY_BILL_ROW
  const typed = lot.actual_qty == null ? parseQty(row.actual) : null
  const newWeight = typed != null
  const awaiting = lot.queue_state === "AWAITING_INSPECTION"
  const explicit = row.decision
  const decision: BillDecision | "NONE" = explicit || (awaiting || hasReadings(row) ? "ACCEPT" : "NONE")
  const dirty = newWeight || Boolean(explicit) || hasReadings(row)
  const failing = failingChecks(lot, row)
  const needsReason = decision === "HOLD" || decision === "REJECT" || (decision === "ACCEPT" && failing.length > 0) ||
    (decision === "ACCEPT" && (lot.inspection_holds || []).length > 0 && row.closeHolds)
  let problem: string | null = null
  const typo = newWeight ? typoWarning(typed, lot.bill_qty, lot.uom) : null
  if (dirty) {
    if (String(row.actual).trim() && typed == null && lot.actual_qty == null) problem = "Type the weight as a number"
    else if (typed != null && typed <= 0) problem = "The weight must be above zero"
    else if (decision === "ACCEPT" && lot.weight_required_for_accept !== false && rowActual(lot, row) == null) problem = "Weigh it first: Accept needs the actual weight"
    else if (decision !== "NONE" && lot.can_enter === false) problem = "This lot cannot be inspected now"
    else if (needsReason && !row.reasonCode) problem = failing.length ? `Choose why ${failing.join(", ")} is out of band` : "Choose a reason"
    else if (needsReason && /(^|[^A-Z0-9])OTHERS?($|[^A-Z0-9])/.test(row.reasonCode.toUpperCase()) && row.reasonNote.trim().length < 5) problem = "Write a short note for Other"
    else if (typo && !row.confirmFar) problem = `${typo}. Confirm it.`
    else if (decision === "NONE" && !newWeight) problem = "Nothing to save"
  }
  return { dirty, decision, needsReason, problem, typo, failing }
}

/** The request row for POST /quality/incoming/bills/{key}/entries. */
export function billRowPayload(lot: BillLot, entry: BillRowEntry, idempotencyKey: string) {
  const plan = planRow(lot, entry)
  const typed = lot.actual_qty == null ? parseQty(entry.actual) : null
  const rules = lotRules(lot)
  return {
    entity_type: lot.entity_type,
    entity_id: lot.entity_id,
    actual_qty: typed,
    decision: plan.decision,
    readings: incomingReadingsPayload(rules, entry.readings),
    reason_code: plan.needsReason && entry.reasonCode ? entry.reasonCode : undefined,
    reason_note: plan.needsReason && entry.reasonNote.trim() ? entry.reasonNote.trim() : undefined,
    note: !plan.needsReason && entry.note.trim() ? entry.note.trim() : undefined,
    close_holds: Boolean(entry.closeHolds && (lot.inspection_holds || []).length),
    base_inspection_id: lot.last_inspection?.id || "",
    confirm_far: Boolean(entry.confirmFar),
    idempotency_key: idempotencyKey,
  }
}

/** "Accept all weighed": Accept on every weighed row with no out-of-band reading that is still open. */
export function acceptAllWeighed(lots: BillLot[], entries: Record<string, BillRowEntry>): Record<string, BillRowEntry> {
  const next = { ...entries }
  for (const lot of lots) {
    const entry = next[lot.key] || EMPTY_BILL_ROW
    if (rowActual(lot, entry) == null || lot.rejected || lot.can_enter === false) continue
    if (lot.queue_state !== "AWAITING_INSPECTION" && !entry.decision) continue
    if (failingChecks(lot, entry).length) continue
    next[lot.key] = { ...entry, decision: "ACCEPT" }
  }
  return next
}

export type BillTiles = { bill: number; weighedCount: number; counted: number; weighedActual: number; weighedBill: number; diff: number; ready: number; uom: string }

/** The four tiles, live while typing: Bill weight, Weighed so far, Difference (so far), Ready for issue. */
export function billTiles(lots: BillLot[], entries: Record<string, BillRowEntry> = {}): BillTiles {
  const counted = lots.filter((lot) => !lot.rejected && lot.bill_qty != null)
  let weighedCount = 0, weighedActual = 0, weighedBill = 0
  for (const lot of counted) {
    const actual = rowActual(lot, entries[lot.key])
    if (actual == null) continue
    weighedCount += 1
    weighedActual += actual
    weighedBill += Number(lot.bill_qty)
  }
  const units = Array.from(new Set(counted.map((lot) => String(lot.uom || "KG").toUpperCase())))
  return {
    bill: counted.reduce((sum, lot) => sum + Number(lot.bill_qty), 0),
    weighedCount, counted: counted.length,
    weighedActual: Math.round(weighedActual * 1000) / 1000,
    weighedBill: Math.round(weighedBill * 1000) / 1000,
    diff: Math.round((weighedActual - weighedBill) * 1000) / 1000,
    ready: lots.filter((lot) => lot.stock_status === "UNRESTRICTED").length,
    uom: units.length === 1 ? units[0] : "MIXED",
  }
}

const compact = (value: unknown) => String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "")

/** The row a scanned or typed code points at: AIT / lot number (leading zeros ignored), vendor reel, or the lot id. */
export function findLotByCode(lots: BillLot[], raw: string, id?: string): BillLot | null {
  if (id) {
    const hit = lots.find((lot) => lot.entity_id.toLowerCase() === id.toLowerCase())
    if (hit) return hit
  }
  const wanted = compact(raw)
  if (!wanted) return null
  const digits = wanted.replace(/^AIT/, "").replace(/^0+/, "")
  return (
    lots.find((lot) => compact(lot.code) === wanted) ||
    lots.find((lot) => lot.vendor_ref && compact(lot.vendor_ref) === wanted) ||
    (digits && /^\d+(-\d+)?$/.test(digits) ? lots.find((lot) => compact(lot.code).replace(/^AIT/, "").replace(/^0+/, "") === digits) || null : null)
  )
}

export const BAND_WORD: Record<string, string> = { WITHIN: "Within limit", EXCESS: "Over the bill", OWNER_DECIDES: "Owner decides", AUTO_DEBIT: "Debit note", OWNER_INFO: "Short on count" }
export const VARIANCE_STATUS_WORD: Record<string, string> = {
  PROVISIONAL: "So far", WITHIN: "Within limit", INFO_SENT: "Owner told", AWAITING_OWNER: "Owner decides", SKIPPED: "Skipped",
  CLAIM_RAISED: "Case raised", WAITING_INVOICE: "Waits for invoice", DN_DRAFTED: "Debit note drafted", CLOSED: "Closed",
}
