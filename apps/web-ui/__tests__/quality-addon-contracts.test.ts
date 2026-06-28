import { strict as assert } from "node:assert"

import { DEFAULT_SPEC_FIELD_DEFINITIONS } from "../lib/spec-sheet"

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

const fieldsByKey = new Map(DEFAULT_SPEC_FIELD_DEFINITIONS.map((field) => [field.field_key, field]))

test("notching spec fields match client dropdown list", () => {
  for (const key of [
    "notch_type",
    "notch_direction",
    "notch_distance_mm",
    "notch_depth_mm",
    "notching_blade",
    "notching_holder",
    "v_flat",
    "punch",
    "notch_wider",
    "notch_patti",
  ]) {
    assert.ok(fieldsByKey.has(key), `${key} must be available to the spec sheet`)
  }
})

test("notching spec fields avoid old unused process fields", () => {
  const oldFields = ["tochha", "tochha_type", "groove", "die", "height_gauge_go", "height_gauge_set", "height_gauge_no_go", "wider_tool"]
  for (const key of oldFields) {
    assert.equal(fieldsByKey.has(key), false, `${key} should not be part of the default notching spec field set`)
  }
})

test("punch and direction fields have practical dropdown options", () => {
  assert.deepEqual(fieldsByKey.get("punch")?.options, ["SINGLE", "DOUBLE", "NA"])
  assert.deepEqual(fieldsByKey.get("notch_direction")?.options, ["FORWARD", "REVERSE"])
  assert.deepEqual(fieldsByKey.get("v_flat")?.options, ["V", "FLAT", "V + FLAT", "NA"])
})

if (failed.length) {
  for (const failure of failed) {
    console.error(`FAIL ${failure.name}`)
    console.error(failure.error)
  }
  process.exit(1)
}

console.log(`PASS ${passed.length}/${passed.length}`)
