import assert from "node:assert/strict"
import { summarizeWorkload, workloadMachine, workloadLoad, clampWorkloadPosition } from "../lib/planner-workload"

const parts = [
  { segment_id: "a", job_card_id: "j1", assigned_winder_machine_id: "w1", segment_planned_qty: 80, required_capacity: 10, current_stage: "WINDER" },
  { segment_id: "b", job_card_id: "j1", assigned_winder_machine_id: "w1", segment_planned_qty: 20, required_capacity: 2.5, current_stage: "WINDER", stale_slot: true },
  { segment_id: "c", job_card_id: "j2", assigned_winder_machine_id: "w2", segment_planned_qty: 100, target_bamboo_count: 8, selected_bamboo_length_mm: 1500, current_stage: "WINDER" },
]
const rows = summarizeWorkload([...parts, parts[0]], "WINDER", "release", id => id.toUpperCase())
assert.equal(rows.length, 2)
assert.deepEqual(rows[0], { id: "w1", label: "W1", parts: 2, cards: 1, pcs: 100, load: 12.5, unknown: 0, ready: 2, waiting: 0 })
assert.equal(rows[1].load, 12)
assert.equal(parts.filter(p => workloadMachine(p, "WINDER", "release") === "w1").length, 2, "filter includes missed slots")
assert.equal(workloadMachine({ current_stage: "WINDER", current_machine_id: "w1" }, "OVEN", "machine"), "unassigned", "upstream machine must not become oven assignment")
assert.equal(workloadMachine({ current_stage: "WINDER", machine_id: "o1" }, "OVEN", "machine"), "o1")
assert.equal(workloadLoad({ segment_planned_qty: 101, pcs_per_bamboo: 8, required_capacity: 1 }, "OVEN"), 13, "oven uses whole bamboos, not stored batch placeholders")
assert.equal(workloadLoad({ planned_qty: 101 }, "OVEN"), null)
assert.equal(workloadLoad({ planned_qty: 101 }, "PROCESS"), 101)
assert.equal(workloadLoad({ planned_qty: 101, segment_planned_qty: 0 }, "PROCESS"), 0)
assert.equal(workloadLoad({ planned_qty: 101, required_capacity: NaN }, "WINDER"), null)
const unknown = summarizeWorkload([{ id: "j3", planned_qty: 10, current_stage: "OVEN" }], "OVEN", "machine", id => id)
assert.equal(unknown[0].unknown, 1)
assert.equal(unknown[0].load, 0)
assert.equal(unknown[0].pcs, 10)
assert.deepEqual(clampWorkloadPosition({ x: 9999, y: -100 }, { width: 390, height: 700 }, { width: 374, height: 500 }), { x: 8, y: 8 })
assert.deepEqual(clampWorkloadPosition({ x: NaN, y: Infinity }, { width: 1440, height: 900 }, { width: 382, height: 400 }), { x: 1050, y: 160 })
assert.deepEqual(clampWorkloadPosition({ x: 10, y: -999 }, { width: 390, height: 700 }, { width: 374, height: 600 }, 64), { x: 8, y: 64 }, "drag handle stays below top bar")
console.log("Planner workload: split identity, queue filters, stage units, incomplete load and viewport bounds passed")
