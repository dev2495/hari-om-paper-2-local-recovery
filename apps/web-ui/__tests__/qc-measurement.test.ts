import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import {
  QC_STAGE_PARAMETERS,
  collectStageQualityChecks,
  formatAllowedRange,
  frozenStageRules,
  qcActionLabel,
  qcSetupStatus,
} from "../lib/qc-measurement"

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

test("winding uses Height not Length and oven/process keep client fields", () => {
  assert.deepEqual(QC_STAGE_PARAMETERS.WINDER.map((row) => row.code), ["id", "od", "height", "weight", "cs"])
  assert.deepEqual(QC_STAGE_PARAMETERS.OVEN.map((row) => row.code), ["pre_weight", "post_weight", "pre_moisture", "post_moisture"])
  assert.deepEqual(
    QC_STAGE_PARAMETERS.PROCESS.map((row) => row.code),
    ["height", "weight", "cs", "notch_distance", "notch_depth", "moisture"],
  )
})

test("frozen allowed range never invents a band", () => {
  assert.equal(formatAllowedRange({ min: 118, max: 122, unit: "mm" }), "Allowed: 118–122 mm")
  assert.equal(formatAllowedRange({ min: null, max: null, unit: "mm" }), "Allowed: not configured")
  assert.equal(qcActionLabel(qcSetupStatus(null)), "Add QC")
  assert.equal(qcActionLabel(qcSetupStatus({ status: "draft", stages: { WINDER: { parameters: [{ code: "id", min: 1, max: 2, required: true }] } } })), "Complete QC")
})

test("job-card winding collect uses height and does not copy length as the official reading when height exists", () => {
  const checks = collectStageQualityChecks("WINDER", {
    dimension_readings: [{ height: "120", id: "77", od: "91", weight: "250", cs: "320" }],
  })
  assert.equal(checks.readings.height, 120)
  assert.equal(checks.hasReadings, true)
})

test("job card, spec dialog, and quality desks keep stage-specific fields", () => {
  const jobCard = readFileSync(resolve(process.cwd(), "components/production/JobCardDocument.tsx"), "utf8")
  const qualityStage = readFileSync(resolve(process.cwd(), "app/(dashboard)/quality/stage/page.tsx"), "utf8")
  const reports = readFileSync(resolve(process.cwd(), "app/(dashboard)/reports/quality/page.tsx"), "utf8")
  const eod = readFileSync(resolve(process.cwd(), "app/(dashboard)/production/eod-entry/page.tsx"), "utf8")
  const incoming = readFileSync(resolve(process.cwd(), "app/(dashboard)/quality/incoming/page.tsx"), "utf8")
  assert.match(jobCard, /renderStageQc\("WINDER"\)/)
  assert.match(jobCard, /renderStageQc\("OVEN"\)/)
  assert.match(jobCard, /renderStageQc\("PROCESS"\)/)
  assert.match(jobCard, />Height</)
  assert.doesNotMatch(jobCard, /Dimension Readings<\/div>\s*<table[\s\S]*?>Length</)
  assert.match(qualityStage, /WINDER/)
  assert.match(qualityStage, /pre_weight|OVEN/)
  assert.match(reports, /allow=\{\["QC"/)
  assert.match(eod, /redirect\("\/production\/supervisor-entry"\)/)
  assert.doesNotMatch(incoming, /Pass and release/)
  assert.match(incoming, /Client status/)
})

test("frozen stage rules expose allowed display fields", () => {
  const rules = frozenStageRules(
    { stages: { WINDER: { parameters: [{ code: "height", label: "Height", unit: "mm", min: 118, max: 122 }] } } },
    "WINDER",
  )
  const height = rules.find((row) => row.code === "height")
  assert.equal(formatAllowedRange(height), "Allowed: 118–122 mm")
})

if (failed.length) {
  for (const failure of failed) {
    console.error(`FAIL ${failure.name}`)
    console.error(failure.error)
  }
  process.exit(1)
}

console.log(`PASS ${passed.length}/${passed.length}`)
