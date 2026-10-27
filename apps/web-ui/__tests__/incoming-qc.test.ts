import { strict as assert } from "node:assert"
import { EMPTY_ENTRY, cellVerdict, groupIncomingQueue, incomingReadingsPayload, incomingReasonsPayload, previewIncomingLot } from "../lib/incoming-qc"

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

// Out of band fails and needs a reason; the reason goes on every failing check.
const fail = entry({ gsm: "150", width_mm: "1200", seal: "NG" }, { reason: "Light paper" })
assert.equal(previewIncomingLot(rules, fail).kind, "fail")
assert.equal(previewIncomingLot(rules, fail).needsReason, true)
assert.deepEqual(incomingReasonsPayload(rules, fail), { gsm: "Light paper", seal: "Light paper" })

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

console.log("incoming-qc tests passed")
