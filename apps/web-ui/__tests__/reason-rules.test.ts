import { strict as assert } from "node:assert"
import { filterReasons, reasonComplete, reasonNeedsNote, reasonPayload, reasonProblem, reasonText, storedReasonText } from "../components/reasons/reason-rules"

const rows = [
  { code: "QH-SUSPECT", label: "Suspected quality problem", category: "QC_HOLD" },
  { code: "QH-OTHER", label: "Other (write a note)", category: "QC_HOLD" },
  { code: "QH-OLD", label: "Old reason", category: "QC_HOLD", is_active: false },
]

assert.equal(reasonNeedsNote("QH-OTHER"), true)
assert.equal(reasonNeedsNote("others"), true)
assert.equal(reasonNeedsNote("SO-CUSTOMER-CHOSE-ANOTHER-SUPPLIER"), false, "ANOTHER inside a word needs no note")

assert.equal(reasonProblem({ code: "", note: "typed text only" }), "Choose a reason from the list.", "free text alone is not a reason")
assert.equal(reasonProblem({ code: "", note: "" }, false), null, "an optional reason may be left empty")
assert.match(String(reasonProblem({ code: "QH-OTHER", note: "abc" })), /at least 5/)
assert.equal(reasonComplete({ code: "QH-OTHER", note: "edge bent" }), true)
assert.equal(reasonComplete({ code: "QH-SUSPECT", note: "" }), true)

assert.equal(reasonText(rows, { code: "QH-SUSPECT", note: " moisture " }), "Suspected quality problem — moisture")
assert.deepEqual(reasonPayload(rows, { code: "qh-suspect", note: "" }), { reason_code: "QH-SUSPECT", reason: "Suspected quality problem" })
assert.deepEqual(
  reasonPayload(rows, { code: "QH-OTHER", note: "Bent edge" }, "notes"),
  { reason_code: "QH-OTHER", reason_note: "Bent edge", notes: "Other (write a note) — Bent edge" },
  "the legacy field carries Label — note",
)
assert.deepEqual(reasonPayload(rows, { code: "QH-SUSPECT", note: "" }, null), { reason_code: "QH-SUSPECT" })

assert.deepEqual(filterReasons(rows, "").map((r) => r.code), ["QH-SUSPECT", "QH-OTHER"], "inactive codes are never offered")
assert.deepEqual(filterReasons(rows, "suspect").map((r) => r.code), ["QH-SUSPECT"])
assert.deepEqual(filterReasons(rows, "qh-oth").map((r) => r.code), ["QH-OTHER"], "search matches the code too")

assert.equal(storedReasonText({ reason_label: "Power cut", reason_code: "DT-POWER", reason_note: "2 hours" }), "Power cut — 2 hours")
assert.equal(storedReasonText({ reason: "old typed text" }), "old typed text", "old records keep their text")

console.log("reason-rules tests passed")
