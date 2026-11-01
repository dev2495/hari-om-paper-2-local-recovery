import assert from "node:assert/strict"

import { boxReady, boxSelectionTotals, boxStateText, pickBox, selectReadyWithin } from "../lib/boxes"
import { boxPackingLabel, challanBoxLine, challanBoxView, previewBoxPacking } from "../lib/dispatch-document"

// Box cards (owner decision 1 Nov 2026): the challan is built from boxes; a box ships only when packed and in stock.
const box = (seq: number, qty: number, extra: Record<string, unknown> = {}) => ({
  id: `id-${seq}`, seq_no: seq, box_code: `B261014-${String(seq).padStart(3, "0")}`, qty, is_part: false,
  status: "PACKED" as const, fg_status: "POSTED" as const, qc_flagged: false, challan_no: null as string | null, ...extra,
})
const boxes = [
  box(1, 30),
  box(2, 30, { qc_flagged: true }),
  box(3, 30, { status: "DISPATCHED", challan_no: "DC/26-27/0007" }),
  box(4, 30, { fg_status: "PENDING" }),
  box(5, 10, { is_part: true }),
  box(6, 30, { status: "RETAINED" }),
  box(7, 30, { fg_status: "FAILED" }),
]

assert.equal(boxReady(boxes[0]), true)
assert.equal(boxReady(boxes[2]), false)
assert.equal(boxReady(boxes[3]), false)
assert.equal(boxStateText(boxes[0]), "In stock")
assert.equal(boxStateText(boxes[2]), "Shipped on DC/26-27/0007")
assert.equal(boxStateText(boxes[3]), "Waiting for stock posting")
assert.equal(boxStateText(boxes[5]), "Kept as surplus")
assert.equal(boxStateText(boxes[6]), "Stock posting failed")

// Totals follow box order whatever order the ticks came in.
const totals = boxSelectionTotals(boxes, ["id-5", "id-1", "id-2"])
assert.deepEqual(totals.boxes.map((b) => b.box_code), ["B261014-001", "B261014-002", "B261014-005"])
assert.equal(totals.count, 3)
assert.equal(totals.pcs, 70)
assert.equal(totals.full, 2)
assert.equal(totals.part, 1)
assert.equal(totals.flagged, 1)
assert.equal(totals.text, "2 boxes × 30 + part box 10 = 70 pcs")
assert.equal(boxSelectionTotals(boxes, []).text, "No boxes")

// Select all ready: only packed + in-stock boxes, and only what fits in the pcs that may ship now.
assert.deepEqual(selectReadyWithin(boxes, 1000), { ids: ["id-1", "id-2", "id-5"], pcs: 70, left_out: 0 })
assert.deepEqual(selectReadyWithin(boxes, 45), { ids: ["id-1", "id-5"], pcs: 40, left_out: 1 })
assert.deepEqual(selectReadyWithin(boxes, 0), { ids: [], pcs: 0, left_out: 3 })

// Scan / type: bare code, lower case, or the label link; plain words for every refusal.
assert.equal(pickBox(boxes, "b261014-001", []).added, true)
// Issue #10: typed without the dash or with a space, still the one box of this card.
assert.equal(pickBox(boxes, "b261014001", []).box?.id, "id-1")
assert.equal(pickBox(boxes, "B261014 002", []).box?.id, "id-2")
assert.equal(pickBox(boxes, "b2610140019", []).ok, false)
assert.equal(pickBox(boxes, "https://erp.example/production/boxes/B261014-002?x=1", []).box?.id, "id-2")
assert.match(pickBox(boxes, "B261014-001", []).message, /ticked: 30 pcs/)
assert.match(pickBox(boxes, "B261014-005", []).message, /part box/)
assert.deepEqual([pickBox(boxes, "B261014-001", ["id-1"]).ok, pickBox(boxes, "B261014-001", ["id-1"]).added], [true, false])
assert.match(pickBox(boxes, "B261014-001", ["id-1"]).message, /already ticked/)
assert.equal(pickBox(boxes, "hello", []).ok, false)
assert.match(pickBox(boxes, "hello", []).message, /not a box code/)
assert.match(pickBox(boxes, "B261099-001", []).message, /not on this job card/)
assert.match(pickBox(boxes, "B261014-003", []).message, /already shipped on challan DC\/26-27\/0007/)
assert.match(pickBox(boxes, "B261014-004", []).message, /not in stock yet \(waiting for the stock posting\)/)
assert.match(pickBox(boxes, "B261014-007", []).message, /stock posting failed/)
assert.match(pickBox(boxes, "B261014-006", []).message, /kept as surplus/)

// Challan document: old quantity challans have no box view and render as before.
assert.equal(challanBoxView({ items: [{ total_pcs: 100 }] }), null)
assert.equal(challanBoxView({ boxes: [] }), null)
assert.equal(boxPackingLabel("R-150"), "Box R-150")
assert.equal(boxPackingLabel("Box 5-ply"), "Box 5-ply")
assert.equal(boxPackingLabel(""), "Box")

const sealed = {
  boxes: [
    { id: "a", box_code: "B261014-001", qty: 30, is_part: false, qc_flagged: false },
    { id: "b", box_code: "B261014-002", qty: 30, is_part: false, qc_flagged: true },
    { id: "c", box_code: "B261014-005", qty: 10, is_part: true, qc_flagged: false },
  ],
  box_packing: { box_code: "R-150", box_size: "600×400×300 mm", qty_per_box: 30, plastic_sku: "PL-01", plastic_per_box: 2, fadda_sku: null, fadda_per_box: 4 },
}
const view = challanBoxView(sealed)!
assert.equal(view.packingLabel, "Box R-150")
assert.equal(view.units, 3)
assert.equal(view.perUnit, 30)
// Issue #6: the goods line reads Units 3 · PCS/Unit "30 (part box 10)" · Total 70, like the boxes block.
assert.equal(view.perUnitText, "30 (part box 10)")
assert.equal(view.totalPcs, 70)
assert.equal(challanBoxView({ boxes: [{ box_code: "x1", qty: 45 }, { box_code: "x2", qty: 45 }, { box_code: "x3", qty: 45 }, { box_code: "x4", qty: 30, is_part: true }], box_packing: { qty_per_box: 45 } })!.perUnitText, "45 (part box 30)")
assert.equal(challanBoxView({ boxes: [{ box_code: "x1", qty: 45 }, { box_code: "x2", qty: 45 }], box_packing: { qty_per_box: 45 } })!.perUnitText, "45")
assert.equal(challanBoxView({ boxes: [{ box_code: "x4", qty: 30, is_part: true }], box_packing: { qty_per_box: 45 } })!.perUnitText, "part box 30")
assert.equal(challanBoxView({ boxes: [{ box_code: "x1", qty: 45 }, { box_code: "x4", qty: 30, is_part: true }, { box_code: "x5", qty: 5, is_part: true }], box_packing: { qty_per_box: 45 } })!.perUnitText, "45 (part boxes 30, 5)")
assert.deepEqual(view.boxes.map((b) => [b.code, b.qty, b.part]), [["B261014-001", 30, false], ["B261014-002", 30, false], ["B261014-005", 10, true]])
assert.equal(view.packing.box, "R-150 · 600×400×300 mm")
assert.equal(view.packing.plastic, "2 × PL-01")
assert.equal(view.packing.fadda, "4")
assert.equal(view.packing.line, "2 boxes × 30 + part box 10 = 70 pcs")
// No qty per box in the spec: pcs per unit falls back to the largest full box.
assert.equal(challanBoxView({ boxes: sealed.boxes, box_packing: {} })!.perUnit, 30)
assert.equal(challanBoxView({ boxes: sealed.boxes })!.packing.plastic, "")
assert.equal(challanBoxLine([{ code: "x", qty: 12, part: true, flagged: false }]), "part box 12 = 12 pcs")

// The page's preview packing block matches what the server writes at sealing.
assert.deepEqual(previewBoxPacking(sealed.box_packing, sealed.boxes), {
  box_code: "R-150", box_size: "600×400×300 mm", qty_per_box: 30, plastic_sku: "PL-01", plastic_per_box: 2, fadda_sku: null, fadda_per_box: 4,
  box_count: 3, full_boxes: 2, part_boxes: 1, total_pcs: 70,
})

console.log("dispatch-boxes tests passed")
