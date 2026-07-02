import { strict as assert } from "node:assert"

import {
  DEFAULT_SPEC_FIELD_DEFINITIONS,
  NOTCH_DIAGRAM_FIELD_KEYS,
  NOTCH_DIRECTION_OPTIONS,
  NOTCH_TOOL_FIELD_CATEGORY_MAP,
  NOTCH_TOOL_FIELD_KEYS,
  TOOL_CATEGORY_LABELS,
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
    "notching_blade",
    "notching_holder",
    "v_flat",
    "punch",
    "notch_direction",
    "notch_distance_mm",
    "notch_depth_mm",
  ]) {
    assert.ok(fieldsByKey.has(key), `${key} must be available to the spec sheet`)
  }
})

test("notching tool dropdowns are backed by tool master categories", () => {
  assert.deepEqual([...NOTCH_TOOL_FIELD_KEYS].sort(), [
    "notch_type",
    "notching_blade",
    "notching_holder",
    "punch",
    "v_flat",
  ].sort())
  assert.deepEqual(NOTCH_TOOL_FIELD_CATEGORY_MAP.notch_type, ["NOTCH"])
  assert.deepEqual(NOTCH_TOOL_FIELD_CATEGORY_MAP.notching_blade, ["BLADE"])
  assert.deepEqual(NOTCH_TOOL_FIELD_CATEGORY_MAP.notching_holder, ["HOLDER"])
  assert.deepEqual(NOTCH_TOOL_FIELD_CATEGORY_MAP.v_flat, ["V_FLAT"])
  assert.deepEqual(NOTCH_TOOL_FIELD_CATEGORY_MAP.punch, ["PUNCH"])
  for (const key of NOTCH_TOOL_FIELD_KEYS) {
    assert.equal(fieldsByKey.get(key)?.field_type, "select", `${key} must render as a dropdown`)
    assert.equal(fieldsByKey.get(key)?.options, undefined, `${key} must not use hard-coded spec options`)
  }
})

test("tool categories and non-tool notch inputs match the client correction", () => {
  assert.deepEqual(Object.keys(TOOL_CATEGORY_LABELS), ["NOTCH", "BLADE", "HOLDER", "V_FLAT", "PUNCH"])
  assert.deepEqual([...NOTCH_DIAGRAM_FIELD_KEYS], ["notch_distance_mm", "notch_depth_mm"])
  assert.deepEqual([...NOTCH_DIRECTION_OPTIONS], ["Clockwise", "Anticlockwise"])
  assert.equal(fieldsByKey.get("notch_direction")?.field_type, "select")
  assert.deepEqual(fieldsByKey.get("notch_direction")?.options, ["Clockwise", "Anticlockwise"])
  assert.equal(fieldsByKey.get("notch_distance_mm")?.field_type, "number")
  assert.equal(fieldsByKey.get("notch_depth_mm")?.field_type, "number")
})

test("sample master tools map to only their matching spec dropdown", () => {
  const sampleTools = [
    { category: "NOTCH", name: "Bottom RHS - 7mm Step 55deg" },
    { category: "BLADE", name: "Plain Blade 1.1mm BAR 01 POY" },
    { category: "HOLDER", name: "Holder BAR 04 FDY" },
    { category: "V_FLAT", name: "V+Flat 90+80 x 3.5" },
    { category: "PUNCH", name: "Double" },
  ]
  const valuesForField = (fieldKey: string) => {
    const categories = NOTCH_TOOL_FIELD_CATEGORY_MAP[fieldKey] || []
    return sampleTools.filter((tool) => categories.includes(tool.category)).map((tool) => tool.name)
  }

  assert.deepEqual(valuesForField("notch_type"), ["Bottom RHS - 7mm Step 55deg"])
  assert.deepEqual(valuesForField("notching_blade"), ["Plain Blade 1.1mm BAR 01 POY"])
  assert.deepEqual(valuesForField("notching_holder"), ["Holder BAR 04 FDY"])
  assert.deepEqual(valuesForField("v_flat"), ["V+Flat 90+80 x 3.5"])
  assert.deepEqual(valuesForField("punch"), ["Double"])
  assert.deepEqual(valuesForField("notch_direction"), [])
  assert.deepEqual(valuesForField("notch_distance_mm"), [])
  assert.deepEqual(valuesForField("notch_depth_mm"), [])
})

test("notching spec fields avoid old unused process fields", () => {
  const oldFields = [
    "tochha",
    "tochha_type",
    "groove",
    "die",
    "height_gauge_go",
    "height_gauge_set",
    "height_gauge_no_go",
    "wider_tool",
    "notch_thickness",
    "notch_design",
    "notch_code",
    "notch_degree",
    "blade_type",
    "blade_thickness",
    "blade_code",
    "blade_height",
    "blade_length",
    "holder_thickness",
    "holder_code",
    "holder_height",
    "holder_length",
    "v_flat_code",
    "v_flat_length",
    "v_flat_thickness",
    "notch_wider",
    "notch_patti",
  ]
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
