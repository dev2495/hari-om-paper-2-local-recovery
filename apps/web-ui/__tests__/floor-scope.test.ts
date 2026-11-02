import assert from "node:assert/strict"

import { floorScope, isOperatorOnly, scopedStageGate, stageForDepartment, unlinkedNote } from "../lib/floor-scope"

// Operator scan scope (owner, 2 Nov 2026): screen flow only; the server rules are unchanged.
const employees = [
  { id: "w1", name: "Ramesh", department: "WINDER", email: "Winder.Op@hariom.com", active: true },
  { id: "o1", name: "Suresh", department: "oven", email: "oven.op@hariom.com", active: true },
  { id: "q1", name: "Kiran", department: "QC", email: "qc.floor@hariom.com", active: true },
  { id: "x1", name: "Old winder", department: "WINDER", email: "left@hariom.com", active: false },
  { id: "d1", name: "Two rows A", department: "WINDER", email: "two@hariom.com", active: true },
  { id: "d2", name: "Two rows B", department: "PROCESS", email: "two@hariom.com", is_active: true },
]

// Who counts as an operator: every role is Operator.
assert.equal(isOperatorOnly(["Operator"]), true)
assert.equal(isOperatorOnly(["Operator", "Operator", null]), true)
assert.equal(isOperatorOnly(["operator"]), true, "case does not matter")
assert.equal(isOperatorOnly(["Operator", "PlantManager"]), false, "a supervisor who is also an operator keeps the full form")
assert.equal(isOperatorOnly(["Owner", "Admin", "Planner"]), false)
assert.equal(isOperatorOnly(["QC"]), false)
assert.equal(isOperatorOnly(["InProcessQC"]), false)
assert.equal(isOperatorOnly([]), false, "no roles is not an operator")

assert.equal(stageForDepartment("WINDER"), "WINDER")
assert.equal(stageForDepartment(" oven "), "OVEN")
assert.equal(stageForDepartment("PROCESS"), "PROCESS")
assert.equal(stageForDepartment("QC"), null)
assert.equal(stageForDepartment(""), null)

// Scope: linked by the login email on the employee row (case and spaces ignored).
assert.deepEqual(floorScope({ roles: ["PlantManager"], email: "winder.op@hariom.com", employees }), { kind: "full" }, "a supervisor keeps the full form even when linked")
assert.deepEqual(floorScope({ roles: ["Owner", "Admin"], email: "admin@hariom.com", employees }), { kind: "full" })
const winder = floorScope({ roles: ["Operator"], email: " winder.op@HARIOM.com ", employees })
assert.equal(winder.kind, "stage")
assert.equal(winder.kind === "stage" && winder.stage, "WINDER")
assert.equal(winder.kind === "stage" && winder.employee.id, "w1", "logs as their own employee")
const oven = floorScope({ roles: ["Operator"], email: "oven.op@hariom.com", employees })
assert.equal(oven.kind === "stage" && oven.stage, "OVEN")
const unlinked = floorScope({ roles: ["Operator"], email: "nobody@hariom.com", employees })
assert.equal(unlinked.kind, "unlinked")
assert.equal(unlinked.kind === "unlinked" && unlinked.why, "no-employee")
assert.match(unlinkedNote(unlinked), /ask the Admin to link your login in Masters › Employees/i)
assert.equal((floorScope({ roles: ["Operator"], email: "left@hariom.com", employees }) as any).why, "no-employee", "an inactive employee row does not link")
assert.equal((floorScope({ roles: ["Operator"], email: "qc.floor@hariom.com", employees }) as any).why, "no-stage", "a QC-department employee runs no floor stage")
assert.match(unlinkedNote(floorScope({ roles: ["Operator"], email: "qc.floor@hariom.com", employees })), /QC department/)
assert.equal((floorScope({ roles: ["Operator"], email: "two@hariom.com", employees }) as any).why, "several", "two departments: never guess")
assert.equal((floorScope({ roles: ["Operator"], email: "", employees: [{ id: "e", department: "OVEN", email: "", active: true }] }) as any).why, "no-employee", "a blank email never links")
assert.equal(unlinkedNote({ kind: "full" }), "")

// Gate: is the operator's stage open on this card?
const stages = (overrides: Record<string, any> = {}) =>
  [
    { stage: "SLITTING", status: "COMPLETED", unit: "kg" },
    { stage: "WINDER", status: "RUNNING", accepted_total: 0, target: 60, unit: "bamboo", available_from_upstream: null },
    { stage: "OVEN", status: "ASSIGNED", accepted_total: 0, target: 60, unit: "bamboo", input_unit: "bamboo", available_from_upstream: 0, awaiting_qc_from_upstream: 0 },
    { stage: "PROCESS", status: "ASSIGNED", accepted_total: 0, target: 600, unit: "pcs", input_unit: "bamboo", available_from_upstream: 0 },
    { stage: "DISPATCH", status: "PLANNED", unit: "pcs" },
  ].map((s) => ({ ...s, ...(overrides[s.stage] || {}) }))

assert.deepEqual(scopedStageGate(stages(), "WINDER"), { open: true, kind: "open", message: "" }, "Winding after slitting is always open")
const waitingOven = scopedStageGate(stages(), "OVEN")
assert.equal(waitingOven.open, false)
assert.equal(waitingOven.kind, "waiting")
assert.equal(waitingOven.message, "This card is at Winding; Oven opens when Winding passes bamboo.")
assert.equal(scopedStageGate(stages({ OVEN: { awaiting_qc_from_upstream: 25 } }), "OVEN").message, "This card is at Winding; Oven opens when Winding QC is recorded (25 bamboo waiting).")
assert.equal(scopedStageGate(stages({ OVEN: { available_from_upstream: 30 } }), "OVEN").open, true, "bamboo ready from Winding opens Oven")
assert.equal(scopedStageGate(stages({ OVEN: { status: "RUNNING" } }), "OVEN").open, true, "a running stage stays open (QC on its runs) even with nothing new ready")
assert.equal(scopedStageGate(stages({ OVEN: { draft_count: 1 } }), "OVEN").open, true, "runs with the supervisor keep it open")
const process = scopedStageGate(stages(), "PROCESS")
assert.equal(process.message, "This card is at Winding; Process opens when Oven passes bamboo.", "the line names where the card really is")
const closed = scopedStageGate(stages({ WINDER: { status: "COMPLETED", accepted_total: 60 }, OVEN: { status: "RUNNING" } }), "WINDER")
assert.equal(closed.kind, "closed")
assert.equal(closed.message, "Winding is closed on this card (60 bamboo good). The card is at Oven now.")
assert.equal(scopedStageGate(stages(), "PACKING").kind, "missing")
assert.equal(scopedStageGate(stages(), "WINDER", false).kind, "card-closed", "a completed or cancelled card takes nothing")
assert.equal(scopedStageGate([], "OVEN").message, "This card has no Oven stage.")

console.log("floor-scope: ok")
