import { qcExceptionFeedback, qcInputKind, type QcParameterRule } from "./qc-measurement"

export type IncomingDecision = "AUTO" | "HOLD" | "REJECT"

export type IncomingEntry = {
  readings: Record<string, string>
  decision: IncomingDecision
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

export const EMPTY_ENTRY: IncomingEntry = { readings: {}, decision: "AUTO", reason: "", closeHolds: true }

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

/** The row's one reason explains every failing check of that lot (the API wants a reason per failed code). */
export function incomingReasonsPayload(rules: QcParameterRule[], entry: IncomingEntry) {
  const reason = entry.reason.trim()
  if (!reason) return {}
  return Object.fromEntries(
    applicableRules(rules)
      .filter((rule) => {
        const verdict = cellVerdict(rule, entry.readings[rule.code])
        return verdict === "FAIL" || verdict === "INVALID"
      })
      .map((rule) => [rule.code, reason]),
  )
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
