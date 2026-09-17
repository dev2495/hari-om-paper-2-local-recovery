import { strict as assert } from "node:assert"

import { LANDING_LABELS, ROLE_PRIORITY, ROLE_TO_LANDING, landingPathForRole, resolveLandingRole } from "../lib/workspace"

const passed: string[] = []
const failed: { name: string; error: unknown }[] = []

function test(name: string, fn: () => void) {
  try {
    fn()
    passed.push(name)
  } catch (error) {
    failed.push({ name, error })
  }
}

test("QC is a canonical landing role, not Plant Manager", () => {
  assert.equal(ROLE_TO_LANDING.QC, "QC")
  assert.equal(resolveLandingRole(["QC"]), "QC")
  assert.notEqual(resolveLandingRole(["QC"]), "PlantManager")
  assert.ok(ROLE_PRIORITY.includes("QC"))
  assert.equal(LANDING_LABELS.QC, "Quality Control")
  assert.equal(landingPathForRole("QC"), "/landing/qc")
})

test("QC does not steal Owner or Plant Manager landings", () => {
  assert.equal(resolveLandingRole(["Owner", "QC"]), "Owner")
  assert.equal(resolveLandingRole(["PlantManager", "QC"]), "PlantManager")
})

if (failed.length) {
  for (const failure of failed) {
    console.error(`FAIL ${failure.name}`)
    console.error(failure.error)
  }
  process.exit(1)
}

console.log(`PASS ${passed.length}/${passed.length}`)
