import assert from "node:assert/strict"

import { canDoSalesAction, concretePlant, salesActionRoles } from "../components/sales/sales-action-roles"

// Order buttons follow the roles the sales service enforces (review 3 Nov 2026).
const sales = salesActionRoles({ role: "Sales", roles: ["Sales"] })
assert.equal(sales.create && sales.edit && sales.submit && sales.approve && sales.hold && sales.resume && sales.close && sales.release, true)
assert.equal(sales.plan, false, "Sales cannot open the planning board")

const planner = salesActionRoles({ role: "Planner", roles: [] })
assert.deepEqual(
  { approve: planner.approve, release: planner.release, plan: planner.plan, schedule: planner.schedule },
  { approve: true, release: true, plan: true, schedule: true },
)
assert.deepEqual(
  { create: planner.create, edit: planner.edit, hold: planner.hold, resume: planner.resume, close: planner.close },
  { create: false, edit: false, hold: false, resume: false, close: false },
)

const plantManager = salesActionRoles({ role: "PlantManager" })
assert.equal(plantManager.close, true, "cancel / short close: CLOSURE_ROLES has PlantManager")
assert.equal(plantManager.plan, true)
assert.equal(plantManager.colours, true)
assert.equal(plantManager.hold || plantManager.approve || plantManager.release || plantManager.edit, false)

for (const role of ["Owner", "Admin"]) {
  const all = salesActionRoles({ role })
  assert.equal(Object.values(all).every(Boolean), true, `${role} passes every check, as on the server`)
}
// A second role on the login counts too.
assert.equal(canDoSalesAction({ role: "Operator", roles: ["Operator", "Sales"] }, "hold"), true)
for (const role of ["Operator", "Dispatch", "Stores", "QC", ""]) {
  const none = salesActionRoles({ role })
  assert.equal(Object.values(none).some(Boolean), false, `${role || "no role"} gets no order button`)
}
assert.equal(canDoSalesAction(null, "create"), false)

// Writes go to a real plant, never "All visible plants".
assert.equal(concretePlant("ALL"), undefined)
assert.equal(concretePlant("all"), undefined)
assert.equal(concretePlant(""), undefined)
assert.equal(concretePlant(null), undefined)
assert.equal(concretePlant(" PLANT_A "), "PLANT_A")

console.log("sales-action-roles tests passed")
