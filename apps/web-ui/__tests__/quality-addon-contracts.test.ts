import { strict as assert } from "node:assert"

import {
  DEFAULT_SPEC_FIELD_DEFINITIONS,
  NOTCH_DIAGRAM_FIELD_KEYS,
  NOTCH_TOOL_FIELD_CATEGORY_MAP,
  NOTCH_TOOL_FIELD_KEYS,
} from "../lib/spec-sheet"

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

test("notching tool dropdowns are backed by tool master categories", () => {
  assert.deepEqual([...NOTCH_TOOL_FIELD_KEYS].sort(), [
    "notch_direction",
    "notch_patti",
    "notch_type",
    "notch_wider",
    "notching_blade",
    "notching_holder",
    "punch",
    "v_flat",
  ].sort())
  assert.deepEqual(NOTCH_TOOL_FIELD_CATEGORY_MAP.notching_blade, ["NOTCHING_BLADE"])
  assert.deepEqual(NOTCH_TOOL_FIELD_CATEGORY_MAP.notch_direction, ["NOTCH_DIRECTION"])
  for (const key of NOTCH_TOOL_FIELD_KEYS) {
    assert.equal(fieldsByKey.get(key)?.field_type, "select", `${key} must render as a dropdown`)
    assert.equal(fieldsByKey.get(key)?.options, undefined, `${key} must not use hard-coded spec options`)
  }
})

test("notch distance and depth remain diagram dimensions", () => {
  assert.deepEqual([...NOTCH_DIAGRAM_FIELD_KEYS], ["notch_distance_mm", "notch_depth_mm"])
  for (const key of NOTCH_DIAGRAM_FIELD_KEYS) {
    assert.equal(fieldsByKey.get(key)?.field_type, "number", `${key} must remain numeric for the diagram`)
  }
})

test("notching spec fields avoid old unused process fields", () => {
  const oldFields = ["tochha", "tochha_type", "groove", "die", "height_gauge_go", "height_gauge_set", "height_gauge_no_go", "wider_tool"]
  for (const key of oldFields) {
    assert.equal(fieldsByKey.has(key), false, `${key} should not be part of the default notching spec field set`)
  }
})

test("only non-tool notch metadata remains outside tool master", () => {
  assert.equal(fieldsByKey.get("notch_required")?.field_type, "boolean")
  assert.equal(fieldsByKey.get("top_paper_required")?.field_type, "boolean")
})

if (failed.length) {
  for (const failure of failed) {
    console.error(`FAIL ${failure.name}`)
    console.error(failure.error)
  }
  process.exit(1)
}

console.log(`PASS ${passed.length}/${passed.length}`)
