import { strict as assert } from "node:assert"
import { groupRows, managementTrail, serverTime, stageTrack, trackStatus } from "../lib/job-card-tracking"

// Server timestamps are naive UTC: 05:30 UTC is 11:00 in the plant, never 05:30.
assert.equal(serverTime("2026-10-27T05:30:15")?.toISOString(), "2026-10-27T05:30:15.000Z")
assert.equal(serverTime("2026-10-27T05:30:15+05:30")?.toISOString(), "2026-10-27T00:00:15.000Z")
assert.equal(serverTime("2026-10-27T05:30:15Z")?.toISOString(), "2026-10-27T05:30:15.000Z")
assert.equal(serverTime(""), null)
assert.equal(serverTime("not a date"), null)

// Status per card for the list and the manager.
assert.equal(trackStatus({ status: "PLANNED", current_stage: "WINDER" }), "QUEUE")
assert.equal(trackStatus({ status: "PLANNED", current_stage: "WINDER", current_shift_code: "SHIFT_A" }), "SCHEDULED")
assert.equal(trackStatus({ status: "IN_PROGRESS", current_stage: "WINDER" }), "RUNNING")
assert.equal(trackStatus({ status: "IN_PROGRESS", current_stage: "WINDER" }, true), "ON_HOLD")
assert.equal(trackStatus({ status: "CANCELLED", close_mode: "CANCELLED" }), "CLOSED_EARLY")
assert.equal(trackStatus({ status: "IN_PROGRESS", close_mode: "FORCE", current_stage: "OVEN" }), "CLOSED_EARLY")
assert.equal(trackStatus({ status: "COMPLETED", current_stage: "DONE" }), "DONE")
assert.deepEqual(stageTrack({ status: "IN_PROGRESS", current_stage: "OVEN" }).map((step) => step.state), ["done", "current", "pending", "pending", "pending", "pending"])

// Group by status and stage reads in flow order, whatever order the rows come in.
const rows = [
  { id: "a", status: "COMPLETED", current_stage: "DONE" },
  { id: "b", status: "PLANNED", current_stage: "WINDER" },
  { id: "c", status: "IN_PROGRESS", current_stage: "PROCESS" },
  { id: "d", status: "IN_PROGRESS", current_stage: "WINDER" },
]
assert.deepEqual(groupRows(rows, "status", (id) => id).map((group) => group.key), ["QUEUE", "RUNNING", "DONE"])
assert.deepEqual(groupRows(rows, "stage", (id) => id).map((group) => group.key), ["WINDER", "PROCESS", "DONE"])
assert.equal(groupRows(rows, "stage", (id) => id)[0].rows.length, 2)

// Management trail: before → after for the qty even where the audit row only has the moved qty.
const trail = managementTrail(
  [
    { id: "1", action: "release_sync_create", actor: "admin", role: "Admin", at: "2026-10-26T10:00:00", payload: {} },
    { id: "2", action: "job_card_split", actor: "planner", role: "Planner", at: "2026-10-26T11:00:00", payload: { qty: 150, child_job_card_no: "26/10/23-A", child_job_card_id: "x", reason: "second winder free" } },
    { id: "3", action: "job_card_amended", actor: "planner", role: "Planner", at: "2026-10-26T12:00:00", payload: { before: { planned_qty: 450, parchment_color: null }, after: { planned_qty: 400, parchment_color: "RED" }, reason: "PO changed" } },
    { id: "4", action: "entry_create", actor: "op", role: "Operator", at: "2026-10-26T13:00:00", payload: {} },
    { id: "5", action: "job_card_force_closed", actor: "head", role: "PlantManager", at: "2026-10-26T14:00:00", payload: { made_qty: 120, returned_qty: 280, mode: "FORCE", reason: "Material short" } },
  ],
  120,
)
assert.deepEqual(trail.map((event) => event.kind), ["CLOSE", "EDIT", "SPLIT", "RELEASE"], "runs are not management changes; newest first")
assert.deepEqual(trail[0].changes[0], { label: "Qty", before: "400 pcs", after: "120 pcs" })
assert.deepEqual(trail[1].changes.map((change) => `${change.label}:${change.before}->${change.after}`), ["Qty:450 pcs->400 pcs", "Colour:plain->RED"])
assert.deepEqual(trail[2].changes[0], { label: "Qty", before: "600 pcs", after: "450 pcs" })
assert.equal(trail[2].card?.no, "26/10/23-A")
assert.equal(trail[2].reason, "second winder free")
const cancelled = managementTrail([{ id: "c", action: "job_card_force_closed", actor: "head", role: null, at: "2026-10-27T05:32:01", payload: { made_qty: 0, returned_qty: 200, mode: "CANCELLED" } }], 200)
assert.equal(cancelled[0].kind, "CANCEL")
assert.deepEqual(cancelled[0].changes[0], { label: "Qty", before: "200 pcs", after: "0 pcs" })

console.log("Job card tracking: status, stage track, grouping, server time and management trail passed")
