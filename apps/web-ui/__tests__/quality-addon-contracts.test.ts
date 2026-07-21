import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import {
  DEFAULT_SPEC_FIELD_DEFINITIONS,
  adhesiveRatioTotal,
  applyPaperMasterToRecipeRow,
  formatRecipeRowsTitle,
  isAdhesiveRatioBalanced,
  isMasterOptionActive,
  isTubeWithinMandrelBand,
  NOTCH_DIAGRAM_FIELD_KEYS,
  NOTCH_DIRECTION_OPTIONS,
  NOTCH_TOOL_FIELD_CATEGORY_MAP,
  NOTCH_TOOL_FIELD_KEYS,
  SPEC_NOTCH_FIELD_KEYS,
  TOOL_CATEGORY_LABELS,
  TOOL_MASTER_POINT_FIELDS,
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
  assert.deepEqual([...SPEC_NOTCH_FIELD_KEYS], [
    "notch_type",
    "notching_blade",
    "notching_holder",
    "v_flat",
    "punch",
    "notch_direction",
    "notch_distance_mm",
    "notch_depth_mm",
  ])
  for (const key of SPEC_NOTCH_FIELD_KEYS) {
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
  assert.equal(fieldsByKey.get("notch_direction")?.options, undefined)
  assert.equal(fieldsByKey.get("notch_distance_mm")?.field_type, "number")
  assert.equal(fieldsByKey.get("notch_distance_mm")?.options, undefined)
  assert.equal(fieldsByKey.get("notch_depth_mm")?.field_type, "number")
  assert.equal(fieldsByKey.get("notch_depth_mm")?.options, undefined)
})

test("tool master captures the client point fields under each of the five categories", () => {
  assert.deepEqual(TOOL_MASTER_POINT_FIELDS.NOTCH.map((field) => field.key), ["type", "thickness", "design", "degree"])
  assert.deepEqual(TOOL_MASTER_POINT_FIELDS.BLADE.map((field) => field.key), ["type", "thickness", "height", "length"])
  assert.deepEqual(TOOL_MASTER_POINT_FIELDS.HOLDER.map((field) => field.key), ["thickness", "height", "length"])
  assert.deepEqual(TOOL_MASTER_POINT_FIELDS.V_FLAT.map((field) => field.key), ["length", "thickness"])
  assert.deepEqual(TOOL_MASTER_POINT_FIELDS.PUNCH.map((field) => field.key), ["punch"])
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

test("no old notch metadata fields remain in the default spec contract", () => {
  for (const key of ["notch_required", "top_paper_required", "tube_direction", "blade", "holder"]) {
    assert.equal(fieldsByKey.has(key), false, `${key} should not be part of the default notching spec field set`)
  }
})

test("discontinued and inactive master records are hidden from spec dropdowns", () => {
  assert.equal(isMasterOptionActive({ id: "active", status: "ACTIVE", active: true }), true)
  assert.equal(isMasterOptionActive({ id: "inactive", status: "INACTIVE" }), false)
  assert.equal(isMasterOptionActive({ id: "discontinued", discontinued: true }), false)
  assert.equal(isMasterOptionActive({ id: "scrap", status: "SCRAPPED" }), false)
  assert.equal(isMasterOptionActive({ id: "maintenance", status: "MAINTENANCE" }), false)
  assert.equal(isMasterOptionActive({ id: "disabled", status: "DISABLED" }), false)
  assert.equal(isMasterOptionActive({ id: "unavailable", status: "UNAVAILABLE" }), false)
  assert.equal(isMasterOptionActive({ id: "deleted", deleted_at: "2026-07-02T00:00:00Z" }), false)
})

test("print contracts use one specification page and exactly two job-card sides", () => {
  const specPrint = readFileSync(resolve(process.cwd(), "components/specs/print/SpecSheetPrint.tsx"), "utf8")
  const jobCardPrint = readFileSync(resolve(process.cwd(), "components/production/JobCardDocument.tsx"), "utf8")

  assert.equal((specPrint.match(/<article className="spec-print-sheet"/g) || []).length, 1)
  assert.match(specPrint, /@page\{size:A4 landscape;margin:5mm\}/)
  assert.match(specPrint, /height:200mm!important/)
  assert.equal((jobCardPrint.match(/<section className="job-print-side job-[a-z-]+-side">/g) || []).length, 2)
  assert.match(jobCardPrint, /page-break-after: always !important/)
  assert.match(jobCardPrint, /page-break-after: auto !important/)
})

test("tube size dropdown is limited to mandrel id plus or minus one mm", () => {
  const mandrel = { outer_diameter_mm: 125.55 }
  assert.equal(isTubeWithinMandrelBand({ inner_diameter_mm: 124.56 }, mandrel), true)
  assert.equal(isTubeWithinMandrelBand({ inner_diameter_mm: 126.55 }, mandrel), true)
  assert.equal(isTubeWithinMandrelBand({ inner_diameter_mm: 123.99 }, mandrel), false)
  assert.equal(isTubeWithinMandrelBand({ inner_diameter_mm: 127.01 }, mandrel), false)
})

test("adhesive ratios must total exactly one hundred before save or approval", () => {
  const valid = [
    { name: "TL-4", base_percent: 15, ratio_percent: 30 },
    { name: "Vinsol", base_percent: 15, ratio_percent: 70 },
  ]
  const invalid = [...valid, { name: "Adhesive 3", base_percent: 15, ratio_percent: 10 }]
  assert.equal(adhesiveRatioTotal(valid), 100)
  assert.equal(isAdhesiveRatioBalanced(valid), true)
  assert.equal(adhesiveRatioTotal(invalid), 110)
  assert.equal(isAdhesiveRatioBalanced(invalid), false)
})

test("paper master facts are copied as locked recipe values", () => {
  const row = applyPaperMasterToRecipeRow(
    {
      id: "r1",
      paper_id: "",
      code: "",
      variety: "",
      category: "",
      gsm: 0,
      bfPerPly: 0,
      thicknessPerPly: 0,
      bulkFactor: 0,
      plyBond: 0,
      plyCount: 1,
      adhesiveLabel: "TL-4",
      positionsText: "",
    },
    {
      id: "paper-1",
      code: "KRAFT-230-18BF",
      variety: "KRAFT",
      category: "Paper",
      gsm: 230,
      bf: 18,
      bulk_factor: 1.3,
      ply_bond: 4.5,
    },
  )

  assert.equal(row.paper_id, "paper-1")
  assert.equal(row.code, "KRAFT-230-18BF")
  assert.equal(row.gsm, 230)
  assert.equal(row.bfPerPly, 18)
  assert.equal(row.thicknessPerPly, 0.299)
  assert.equal(row.bulkFactor, 1.3)
  assert.equal(row.plyBond, 4.5)
})

test("applied paper recipe groups repeated papers into a compact ply summary", () => {
  const base = {
    category: "KRAFT",
    gsm: 250,
    bfPerPly: 18,
    thicknessPerPly: 0.3,
    plyBond: 300,
    adhesiveLabel: "TL-4",
    positionsText: "",
  }
  assert.equal(
    formatRecipeRowsTitle([
      { ...base, id: "1", paper_id: "p1", code: "KRAFT-250-18BF", variety: "250", plyCount: 1 },
      { ...base, id: "2", paper_id: "p1", code: "KRAFT-250-18BF", variety: "250", plyCount: 1 },
      { ...base, id: "3", paper_id: "p2", code: "KRAFT-300-18BF", variety: "300", plyCount: 3 },
    ]),
    "KRAFT-250-18BF × 2 · KRAFT-300-18BF × 3",
  )
})

if (failed.length) {
  for (const failure of failed) {
    console.error(`FAIL ${failure.name}`)
    console.error(failure.error)
  }
  process.exit(1)
}

console.log(`PASS ${passed.length}/${passed.length}`)
