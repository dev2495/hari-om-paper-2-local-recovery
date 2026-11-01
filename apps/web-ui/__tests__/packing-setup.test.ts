import assert from "node:assert/strict"

import {
  addBoxHref,
  boxCodesNotInMaster,
  draftChanged,
  draftFromPacking,
  draftPayload,
  draftProblems,
  filterPackingRows,
  singleDefault,
  type PackingMasters,
  type PackingSetupRow,
  type SpecPacking,
} from "../lib/packing-setup"

// Packing setup (owner decision 5, 1 Nov 2026): box, qty per box, plastic and fadda from the Packaging masters.
const masters: PackingMasters = {
  boxes: [{ code: "R-150", size_label: "400x300x200", weight_kg: 0.45 }],
  plastics: [{ code: "PS-150", size_label: "1x1 m", weight_kg: 0.05 }],
  fadda: [{ code: "FD-3", weight_kg: 0.02 }],
}
const empty: SpecPacking = { box_code: "", qty_per_box: null, plastic_sku: "", plastic_per_box: 1, fadda_sku: "", fadda_per_box: 3 }

// The only active plastic / fadda master is the default; with two there is none.
assert.equal(singleDefault(masters.plastics), "PS-150")
assert.equal(singleDefault([...masters.plastics, { code: "PS-200" }]), "")
const defaulted = draftFromPacking(empty, masters)
assert.deepEqual(defaulted, { box_code: "", qty_per_box: "", plastic_sku: "PS-150", plastic_per_box: "1", fadda_sku: "FD-3", fadda_per_box: "3" })
assert.equal(draftFromPacking({ ...empty, fadda_per_box: null }, masters).fadda_per_box, "1", "a defaulted fadda gets at least 1 per box")
assert.equal(draftFromPacking(empty, { ...masters, plastics: [] }).plastic_sku, "", "no plastic master, no default")

// A box from the master and a whole qty per box are required; codes outside the master never save.
assert.deepEqual(draftProblems(defaulted, masters), ["Choose the box", "Enter qty per box (whole pcs)"])
assert.deepEqual(draftProblems({ ...defaulted, box_code: "R.125", qty_per_box: "48" }, masters), ["Box R.125 is not in the Packaging master"])
assert.deepEqual(draftProblems({ ...defaulted, box_code: "r-150", qty_per_box: "47.5" }, masters), ["Enter qty per box (whole pcs)"])
assert.deepEqual(draftProblems({ ...defaulted, box_code: "R-150", qty_per_box: "48", plastic_sku: "", plastic_per_box: "1" }, masters), ["Choose the plastic or set plastic per box to 0"])
assert.deepEqual(draftProblems({ ...defaulted, box_code: "R-150", qty_per_box: "48", fadda_per_box: "0" }, masters), ["Fadda per box must be at least 1 (or choose no fadda)"])
assert.deepEqual(draftProblems({ ...defaulted, box_code: "R-150", qty_per_box: "48" }, masters), [])

// Changed = what the spec would store differs (a count without its material is stored as 0).
const saved: SpecPacking = { box_code: "R-150", qty_per_box: 48, plastic_sku: "PS-150", plastic_per_box: 1, fadda_sku: "", fadda_per_box: 3 }
const savedDraft = draftFromPacking(saved, { ...masters, fadda: [] })
assert.equal(draftChanged(savedDraft, saved), false)
assert.equal(draftChanged({ ...savedDraft, qty_per_box: "45" }, saved), true)
assert.equal(draftChanged({ ...savedDraft, fadda_sku: "FD-3", fadda_per_box: "3" }, saved), true)

const row = (over: Partial<PackingSetupRow>): PackingSetupRow => ({
  id: "a7f8055a-0000", version: 1, status: "approved", seasonal_model: true, write_revision: 4, customer_id: "c1", customer_name: "Alok Industries",
  id_min_mm: 110, id_max_mm: 110.5, od_min_mm: 122, od_max_mm: 122, length_min_mm: 150, length_max_mm: 150, packing: empty, complete: false, blockers: [], ...over,
})

// The request carries the row's revision and drops counts of materials not chosen.
assert.deepEqual(draftPayload({ ...defaulted, box_code: "r-150", qty_per_box: "48", fadda_sku: "" }, row({}), "req-12345678"), {
  request_id: "req-12345678", expected_version: 4, box_code: "R-150", qty_per_box: 48, plastic_sku: "PS-150", plastic_per_box: 1, fadda_sku: null, fadda_per_box: 0,
})

// Spec box codes missing from the master, most used first, each with an add-box link.
const rows = [
  row({ id: "1", packing: { ...empty, box_code: "R.125" } }),
  row({ id: "2", packing: { ...empty, box_code: "R.125" } }),
  row({ id: "3", packing: { ...empty, box_code: "export" } }),
  row({ id: "4", packing: saved, complete: true, customer_id: "c2", customer_name: "Bharat Tubes" }),
]
assert.deepEqual(boxCodesNotInMaster(rows, masters.boxes), [{ code: "R.125", specs: 2 }, { code: "EXPORT", specs: 1 }])
assert.equal(addBoxHref("R.125"), "/masters/packaging?add=box&code=R.125")

// Filters: missing only, customer, search (customer, box code, spec id).
assert.deepEqual(filterPackingRows(rows, { missingOnly: true, customerId: "", search: "" }).map((r) => r.id), ["1", "2", "3"])
assert.deepEqual(filterPackingRows(rows, { missingOnly: false, customerId: "c2", search: "" }).map((r) => r.id), ["4"])
assert.deepEqual(filterPackingRows(rows, { missingOnly: false, customerId: "", search: "export" }).map((r) => r.id), ["3"])

console.log("packing-setup tests passed")
