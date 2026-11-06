import { strict as assert } from "node:assert"
import { EMPTY_BILL_ROW, EMPTY_ENTRY, acceptAllWeighed, billRowPayload, billRules, billTiles, cellVerdict, findLotByCode, groupIncomingQueue, incomingReadingsPayload, incomingReasonFields, incomingReasonsPayload, planRow, previewIncomingLot, rowDiff, typoWarning } from "../lib/incoming-qc"

const rules: any[] = [
  { code: "gsm", label: "GSM", unit: "g/m²", min: 291, max: 309, required: true },
  { code: "width_mm", label: "Paper width", unit: "mm", min: null, max: null, required: true, record_only: true },
  { code: "seal", label: "Seal", input_type: "select", options: ["OK", "NG"], required: true },
  { code: "remark", label: "Remark", input_type: "text", required: false },
  { code: "notch", label: "Notch", applicable: false, min: 1, max: 2 },
]
const entry = (readings: Record<string, string>, extra: any = {}) => ({ ...EMPTY_ENTRY, readings, ...extra })

// Cells: in band, out of band, not a number, record-only, failing choice.
assert.equal(cellVerdict(rules[0], "300"), "PASS")
assert.equal(cellVerdict(rules[0], "150"), "FAIL")
assert.equal(cellVerdict(rules[0], "abc"), "INVALID")
assert.equal(cellVerdict(rules[1], "1200"), null)
assert.equal(cellVerdict(rules[2], "NG"), "FAIL")
assert.equal(cellVerdict(rules[2], "OK"), "PASS")

// Nothing entered is not saved.
assert.equal(previewIncomingLot(rules, EMPTY_ENTRY).kind, "blank")
assert.equal(previewIncomingLot(rules, EMPTY_ENTRY).willSave, false)

// All required checks in band releases; the optional remark and the not-applicable check are not needed.
const pass = previewIncomingLot(rules, entry({ gsm: "300", width_mm: "1200", seal: "OK" }))
assert.equal(pass.kind, "release")
assert.equal(pass.needsReason, false)

// A required blank keeps it held as incomplete (the server saves INCOMPLETE, not PASS).
const partial = previewIncomingLot(rules, entry({ gsm: "300" }))
assert.equal(partial.kind, "incomplete")
assert.deepEqual(partial.missing, ["Paper width", "Seal"])

// Out of band fails and needs a reason code (INCOMING_QC, owner decision 4); it goes on every failing check.
const fail = entry({ gsm: "150", width_mm: "1200", seal: "NG" }, { reasonCode: "IQ-GSM", reason: "Light paper" })
assert.equal(previewIncomingLot(rules, fail).kind, "fail")
assert.equal(previewIncomingLot(rules, fail).needsReason, true)
assert.deepEqual(incomingReasonsPayload(rules, fail), { gsm: "Light paper", seal: "Light paper" })
assert.deepEqual(incomingReasonFields(fail, true), { reason_code: "IQ-GSM", reason_note: "Light paper" })
// Free text alone is never sent as a reason: no code, no per-check reasons.
const typedOnly = entry({ gsm: "150" }, { reason: "Light paper" })
assert.deepEqual(incomingReasonsPayload(rules, typedOnly), {})
assert.deepEqual(incomingReasonFields(typedOnly, true), { reason_code: undefined, reason_note: "Light paper" })
// When nothing asks why, the text is a plain note.
assert.deepEqual(incomingReasonFields(entry({ gsm: "300" }, { reason: "Edges dusty" }), false), { notes: "Edges dusty" })

// Hold / Reject override the readings and need a reason.
assert.equal(previewIncomingLot(rules, entry({}, { decision: "HOLD" })).kind, "hold")
assert.equal(previewIncomingLot(rules, entry({ gsm: "300" }, { decision: "REJECT" })).needsReason, true)

// A re-check that passes releases only when the earlier hold is closed (with a note).
const recheck = entry({ gsm: "300", width_mm: "1200", seal: "OK" })
assert.equal(previewIncomingLot(rules, recheck, { openHolds: 1 }).kind, "release")
assert.equal(previewIncomingLot(rules, recheck, { openHolds: 1 }).needsReason, true)
assert.equal(previewIncomingLot(rules, { ...recheck, closeHolds: false }, { openHolds: 1 }).kind, "held_by_hold")

// Payload: numbers for measured checks, words for notes and choices, blanks dropped.
assert.deepEqual(incomingReadingsPayload(rules, { gsm: " 300.5 ", seal: "OK", remark: "edge torn", width_mm: "" }), { gsm: 300.5, seal: "OK", remark: "edge torn" })

// Queue groups by inward line, overdue first.
const groups = groupIncomingQueue([
  { entity_type: "BATCH", entity_id: "b1", label: "A/26/001-B001 · PVA", qty: 50, due_at: "2026-10-28T00:00:00Z" },
  { entity_type: "REEL", entity_id: "r1", receipt_line_id: "L1", label: "AT-1 · Kraft 300", qty: 480, due_at: "2026-10-29T00:00:00Z", overdue: true },
  { entity_type: "REEL", entity_id: "r2", receipt_line_id: "L1", label: "AT-2 · Kraft 300", qty: 470, due_at: "2026-10-29T00:00:00Z" },
])
assert.equal(groups.length, 2)
assert.equal(groups[0].key, "line:L1")
assert.equal(groups[0].lots.length, 2)
assert.equal(groups[0].qty, 950)
assert.equal(groups[0].title, "Kraft 300")

// ── Bill-wise QC (6 Nov 2026) ──
const gsmRule: any = { code: "gsm", label: "GSM", unit: "g/m²", min: 115, max: 125, required: false }
const lot = (code: string, bill: number | null, extra: any = {}): any => ({
  key: `REEL:${code}`, entity_type: "REEL", entity_id: `id-${code}`, code, vendor_ref: `R-${code}`, uom: "KG", bill_qty: bill, actual_qty: null,
  queue_state: "AWAITING_INSPECTION", stock_status: "QC_HOLD", can_enter: true, weight_required_for_accept: bill != null,
  quality_profile: { parameters: [gsmRule, { code: "reel_weight_kg", label: "Reel weight", required: true }] }, ...extra,
})
const row = (extra: any = {}) => ({ ...EMPTY_BILL_ROW, ...extra })
const reels = [lot("AIT 06281", 1182), lot("AIT 06284", 1210), lot("AIT 06288", 1189, { actual_qty: 1180, queue_state: "FAILED" }), lot("AIT 06290", 1000, { rejected: true, queue_state: "REJECTED" })]

// The retired typed weight check never shows as a column: the actual weight is built in.
assert.deepEqual(billRules(reels).map((rule) => rule.code), ["gsm"])
// Diff is actual - bill; the saved weight wins over a typed one.
assert.equal(rowDiff(reels[0], row({ actual: "1175" })), -7)
assert.equal(rowDiff(reels[2], row({ actual: "9" })), -9)
assert.equal(rowDiff(reels[1], row()), null)

// Typo guard at 15 %.
assert.equal(typoWarning(11750, 1182), "Check: 11,750 kg vs bill 1,182 kg")
assert.equal(typoWarning(1182 * 1.15, 1182), null)
assert.equal(typoWarning(1000, null), null)

// Accept (the default) needs the weight; Hold and Reject do not, but need a reason.
assert.equal(planRow(reels[0], row()).dirty, false)
assert.equal(planRow(reels[0], row({ decision: "ACCEPT" })).problem, "Weigh it first: Accept needs the actual weight")
assert.equal(planRow(reels[0], row({ decision: "HOLD" })).problem, "Choose a reason")
assert.equal(planRow(reels[0], row({ decision: "HOLD", reasonCode: "IQ-MOISTURE" })).problem, null)
const weighed = planRow(reels[0], row({ actual: "1175" }))
assert.deepEqual([weighed.dirty, weighed.decision, weighed.problem], [true, "ACCEPT", null])
// Out of band reading with Accept still holds and needs an INCOMING_QC code.
const wet = planRow(reels[0], row({ actual: "1175", readings: { gsm: "140" } }))
assert.equal(wet.needsReason, true)
assert.equal(wet.problem, "Choose why GSM is out of band")
// A held lot weighed later sends the weight only; its decision stays.
assert.equal(planRow(lot("AIT 1", 900, { queue_state: "FAILED" }), row({ actual: "899" })).decision, "NONE")
// Far from the bill: asks to confirm.
assert.equal(planRow(reels[0], row({ actual: "11750" })).problem, "Check: 11,750 kg vs bill 1,182 kg. Confirm it.")
assert.equal(planRow(reels[0], row({ actual: "11750", confirmFar: true })).problem, null)
// Other needs a note.
assert.equal(planRow(reels[0], row({ decision: "REJECT", reasonCode: "IQ-OTHER" })).problem, "Write a short note for Other")

// Payload: only typed weight, decision, readings as numbers, base inspection for the two-user check.
const payload = billRowPayload(reels[0], row({ actual: "1,175.5", readings: { gsm: "120" } }), "key-1")
assert.deepEqual([payload.actual_qty, payload.decision, payload.readings, payload.base_inspection_id, payload.reason_code], [1175.5, "ACCEPT", { gsm: 120 }, "", undefined])

// Tiles: rejected lots are left out; the diff counts weighed lots only (saved or typed).
const tiles = billTiles(reels, { "REEL:AIT 06281": row({ actual: "1175" }) })
assert.deepEqual([tiles.bill, tiles.counted, tiles.weighedCount, tiles.weighedActual, tiles.diff], [3581, 3, 2, 2355, -16])

// Accept all weighed: weighed + no out-of-band reading; an out-of-band row is left for a reason.
const all = acceptAllWeighed(reels, { "REEL:AIT 06281": row({ actual: "1175" }), "REEL:AIT 06284": row({ actual: "1200", readings: { gsm: "150" } }) })
assert.equal(all["REEL:AIT 06281"].decision, "ACCEPT")
assert.equal(all["REEL:AIT 06284"].decision, null)
assert.equal(all["REEL:AIT 06290"], undefined)

// Scan: AIT label (any spacing, leading zeros), vendor reel, or the id inside a QR.
assert.equal(findLotByCode(reels, "ait6284")?.code, "AIT 06284")
assert.equal(findLotByCode(reels, "R-AIT 06288")?.code, "AIT 06288")
assert.equal(findLotByCode(reels, "", "id-AIT 06281")?.code, "AIT 06281")
assert.equal(findLotByCode(reels, "AIT 09999"), null)

console.log("incoming-qc tests passed")
