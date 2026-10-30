import assert from "node:assert/strict"

import { blankRow, cleanNumber, duplicateRow, findItem, isBlank, matchItem, matchPlace, matchProblems, parsePaste, rowProblems, toLine } from "../components/opening-stock/rows"

// Go-live opening stock (client 2026-10-30): rows pasted from Excel are matched to materials and locations;
// what matches nothing stays as typed (shown red with a pick list).
const items = [
  { id: "p1", item_code: "KRAFT-120", name: "Kraft paper 120 gsm", type: "RAW_PAPER", tracking_mode: "REEL", uom: "KG", unit_cost: 42 },
  { id: "g1", item_code: "GLUE-PVA", name: "PVA glue", type: "ADHESIVE", tracking_mode: "BULK", uom: "KG" },
  { id: "b1", item_code: "BOX-5PLY", name: "Carton box 5 ply", type: "PACKAGING", tracking_mode: "BULK", uom: "PCS" },
]
const places = [
  { id: "l1", code: "RM-STORE", name: "RM store", active: true, is_receiving_default: true },
  { id: "l2", code: "RM-A-01", name: "Paper rack A1", active: true },
  { id: "l3", code: "OLD-1", name: "Old rack", active: false },
]

assert.equal(matchItem("kraft-120", items)?.id, "p1")
assert.equal(matchItem("PVA glue", items)?.id, "g1")
assert.equal(matchItem("carton", items)?.id, "b1")
assert.equal(matchItem("paper", items)?.id, "p1")
assert.equal(matchItem("nothing like it", items), undefined)
assert.equal(matchPlace("rack a1", places)?.id, "l2")
assert.equal(matchPlace("OLD-1", places), undefined, "an inactive rack is never matched")
assert.equal(cleanNumber("1,234.5 kg"), "1234.5")
assert.equal(cleanNumber("₹ 42"), "42")
assert.equal(cleanNumber("abc"), "abc")

const pasted = parsePaste([
  "Item code\tType\tWeight\tLocation\tOld mark\tVendor\tRate",
  "KRAFT-120\treel\t812.5\tRM-A-01\tOLD-77\tShree Mills\t42",
  "GLUE-PVA\treel\t120\t\t\t\t85",
  "Mystery paper\treel\t500\tRack Z9\tM-1\t\t",
  "BOX-5PLY,bulk,\"1,200\",RM store,,,12",
].join("\n"), items, places)
assert.equal(pasted.length, 4, "the header row is skipped")
assert.deepEqual([pasted[0].item_id, pasted[0].kind, pasted[0].qty, pasted[0].location_id, pasted[0].old_mark, pasted[0].vendor_name, pasted[0].rate], ["p1", "REEL", "812.5", "l2", "OLD-77", "Shree Mills", "42"])
// Glue is kept in bulk: the typed "reel" is corrected, with a note on the row.
assert.equal(pasted[1].kind, "BULK")
assert.match(pasted[1].note, /kept as bulk lots/)
assert.equal(pasted[1].location_id, "", "no location typed → the RM store (default)")
// Nothing matched: kept as typed and flagged.
assert.equal(pasted[2].item_id, "")
assert.equal(pasted[2].item_text, "Mystery paper")
assert.equal(pasted[2].location_text, "Rack Z9")
assert.deepEqual(rowProblems(pasted[2]).map((problem) => problem.field), ["item", "location"])
assert.equal(pasted[3].qty, "1200", "quoted commas in a CSV cell")
assert.equal(pasted[3].location_id, "l1")

const row = { ...blankRow("BULK"), item_id: "g1", qty: "30", on_hold: true, hold_reason: " Lid open ", rate: "" }
assert.deepEqual(toLine(row), { item_id: "g1", kind: "BULK", qty: 30, location_id: undefined, old_mark: undefined, vendor_name: undefined, vendor_ref: undefined, on_hold: true, hold_reason: "Lid open", unit_cost: undefined })
const copy = duplicateRow({ ...row, old_mark: "X1" })
assert.notEqual(copy.key, row.key)
assert.equal(copy.item_id, "g1")
assert.equal(copy.qty, "")
assert.equal(copy.old_mark, "")
assert.ok(isBlank(blankRow("REEL")))
assert.deepEqual(rowProblems({ ...blankRow("REEL"), qty: "0" }).map((problem) => problem.field), ["qty"])

// Several materials share a name: never guess the first one; the row stays red and lists them.
const kraft = [350, 351, 352, 353, 354].map((code) => ({ id: `k${code}`, item_code: String(code), name: "Kraft 350 GSM", type: "RAW_PAPER", tracking_mode: "REEL", uom: "KG" }))
const many = [...items, ...kraft]
assert.equal(matchItem("Kraft 350 GSM", many), undefined, "an exact name shared by five materials is not a match")
assert.equal(findItem("Kraft 350 GSM", many).candidates.length, 5)
assert.equal(matchItem("352", many)?.id, "k352", "an exact code still matches")
assert.equal(matchItem("kraft", many), undefined, "a partial that fits several is not a match")
const [shared, zero, unknown] = parsePaste("Kraft 350 GSM\treel\t500\nGLUE-PVA\tbulk\t0\nFOOBAR\tbulk\t5\tNOWHERE", many, places)
assert.equal(shared.item_id, "")
assert.deepEqual(shared.item_matches, ["350", "351", "352", "353", "354"])
assert.equal(rowProblems(shared)[0].message, '"Kraft 350 GSM" matches 5 materials (350, 351, 352…): pick one.')
// The paste summary counts "matched nothing / several" apart from a quantity to fix.
assert.deepEqual(matchProblems(zero), [])
assert.deepEqual(rowProblems(zero).map((problem) => problem.field), ["qty"])
assert.deepEqual(matchProblems(unknown).map((problem) => problem.field), ["item", "location"])
// Two racks whose names both contain the pasted text: ask, do not guess.
const racks = [...places, { id: "l4", code: "RM-A-02", name: "Paper rack A2", active: true }]
const [rack] = parsePaste("KRAFT-120\treel\t10\tpaper rack", items, racks)
assert.equal(rack.location_id, "")
assert.deepEqual(rack.location_matches, ["RM-A-01", "RM-A-02"])
assert.match(rowProblems(rack)[0].message, /matches 2 locations \(RM-A-01, RM-A-02\)/)

console.log("opening-stock rows: ok")

// Round 2 (30 Oct 2026): pieces are whole numbers and a typed 0 says what is wrong.
{
  const pieces = { ...blankRow("BULK"), item_id: "box", qty: "10.5" }
  assert.equal(rowProblems(pieces, "PCS")[0].message, "Counted in whole pieces: enter 10 or 11, not 10.5.")
  assert.deepEqual(rowProblems({ ...pieces, qty: "11" }, "PCS"), [])
  assert.deepEqual(rowProblems(pieces, "KG"), [])
  assert.equal(rowProblems({ ...blankRow("REEL"), qty: "0" })[0].message, "Weight must be more than 0 kg.")
  assert.equal(rowProblems({ ...blankRow("BULK"), qty: "0" }, "PCS")[0].message, "Quantity must be more than 0.")
  console.log("opening-stock whole pieces: ok")
}
