import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import {
  QC_STAGE_PARAMETERS,
  collectStageQualityChecks,
  formatAllowedRange,
  frozenStageRules,
  inspectionFrozenRules,
  inspectionProfileRevision,
  qcActionLabel,
  qcFieldMeta,
  qcMissingFieldLabels,
  qcRowActions,
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
  assert.deepEqual(QC_STAGE_PARAMETERS.WINDER.map((row) => row.label), ["I.D.", "O.D.", "Height", "Weight", "C.S."])
  assert.deepEqual(QC_STAGE_PARAMETERS.OVEN.map((row) => row.label), ["Pre-weight", "Post-weight", "Pre-moisture", "Post-moisture"])
  assert.deepEqual(
    QC_STAGE_PARAMETERS.PROCESS.map((row) => row.label),
    ["Height", "Weight", "C.S.", "Notch distance", "Notch depth", "Moisture"],
  )
  assert.equal(QC_STAGE_PARAMETERS.WINDER.find((row) => row.code === "height")?.basisHint, "Height at winding")
  assert.equal(QC_STAGE_PARAMETERS.PROCESS.find((row) => row.code === "height")?.basisHint, "Finished height")
})

test("frozen allowed range never invents a band", () => {
  assert.equal(formatAllowedRange({ min: 118, max: 122, unit: "mm" }), "Allowed: 118–122 mm")
  assert.equal(formatAllowedRange({ min: null, max: null, unit: "mm" }), "Allowed: not configured")
  assert.equal(formatAllowedRange({ min: 0, max: 0, unit: "mm", applicable: false }), "NOT APPLICABLE")
  assert.equal(qcActionLabel(qcSetupStatus(null)), "Add quality parameters")
  assert.equal(qcActionLabel(qcSetupStatus({ status: "draft", stages: { WINDER: { parameters: [{ code: "id", min: 1, max: 2, required: true }] } } })), "Complete quality setup")
})

test("incomplete draft save is not QC-ready and keeps missing fields assigned", () => {
  const draft = {
    status: "draft",
    stages: {
      WINDER: { parameters: [{ code: "id", label: "I.D.", min: null, max: null, required: true }] },
    },
  }
  assert.equal(qcSetupStatus(draft), "draft")
  assert.equal(qcActionLabel(qcSetupStatus(draft)), "Complete quality setup")
  assert.deepEqual(qcMissingFieldLabels(draft), ["I.D.", "O.D.", "Height", "Weight", "C.S.", "Pre-weight", "Post-weight", "Pre-moisture", "Post-moisture", "Height", "Weight", "C.S.", "Notch distance", "Notch depth", "Moisture"])
  assert.equal(qcSetupStatus({ status: "complete", stages: { WINDER: { parameters: [{ code: "id" }] } } }), "missing")
})

test("job-card winding collect uses height and does not copy length as the official reading when height exists", () => {
  const checks = collectStageQualityChecks("WINDER", {
    dimension_readings: [{ height: "120", id: "77", od: "91", weight: "250", cs: "320" }],
  })
  assert.equal(checks.readings.height, 120)
  assert.equal(checks.hasReadings, true)
})

test("every winding sample is collected independently", () => {
  const checks = collectStageQualityChecks("WINDER", {
    dimension_readings: [
      { height: "120", id: "77", od: "91", weight: "250", cs: "320" },
      { height: "150", id: "77", od: "91", weight: "250", cs: "320" },
      { height: "", id: "", od: "", weight: "", cs: "" },
    ],
  })
  assert.equal(checks.samples.length, 2)
  assert.equal(checks.samples[0].readings.height, 120)
  assert.equal(checks.samples[1].readings.height, 150)
})

test("whitespace is missing and kg batch values are not copied into g specimen fields", () => {
  const blank = collectStageQualityChecks("WINDER", { qc_readings: { height: "   " } })
  assert.equal(blank.readings.height, undefined)
  const oven = collectStageQualityChecks("OVEN", { pre_oven_weight_kg: "1.2", pre_weight: "" })
  assert.equal(oven.readings.pre_weight, undefined)
  assert.equal(oven.unit_conflicts[0].source_unit, "kg")
  const zero = collectStageQualityChecks("PROCESS", { final_measurements: { moisture: "0" } })
  assert.equal(zero.readings.moisture, 0)
})

test("job card, spec dialog, and quality desks keep stage-specific fields", () => {
  const jobCard = readFileSync(resolve(process.cwd(), "components/production/JobCardDocument.tsx"), "utf8")
  const qualityStage = readFileSync(resolve(process.cwd(), "app/(dashboard)/quality/stage/page.tsx"), "utf8")
  const reports = readFileSync(resolve(process.cwd(), "app/(dashboard)/reports/quality/page.tsx"), "utf8")
  const eod = readFileSync(resolve(process.cwd(), "app/(dashboard)/production/eod-entry/page.tsx"), "utf8")
  const incoming = readFileSync(resolve(process.cwd(), "app/(dashboard)/quality/incoming/page.tsx"), "utf8")
  const nextConfig = readFileSync(resolve(process.cwd(), "next.config.js"), "utf8")
  assert.match(jobCard, /renderStageQc\("WINDER"\)/)
  assert.match(jobCard, /renderStageQc\("OVEN"\)/)
  assert.match(jobCard, /renderStageQc\("PROCESS"\)/)
  assert.match(jobCard, />Height</)
  assert.doesNotMatch(jobCard, /Dimension Readings<\/div>\s*<table[\s\S]*?>Length</)
  assert.match(qualityStage, /WINDER/)
  assert.match(qualityStage, /pre_weight|OVEN/)
  assert.match(reports, /allow=\{\["QC"/)
  assert.match(eod, /redirect\("\/production\/supervisor-entry"\)/)
  assert.match(nextConfig, /source: "\/production\/eod-entry"/)
  assert.match(nextConfig, /destination: "\/production\/supervisor-entry"/)
  assert.doesNotMatch(incoming, /Pass and release/)
  assert.match(incoming, /Client status/)
})

test("spec dialog and remaining shells keep product context and shared headers", () => {
  const dialog = readFileSync(resolve(process.cwd(), "components/qc/SpecQcToleranceDialog.tsx"), "utf8")
  const inventory = readFileSync(resolve(process.cwd(), "app/(dashboard)/inventory/page.tsx"), "utf8")
  const logistics = readFileSync(resolve(process.cwd(), "app/(dashboard)/logistics/dispatch/page.tsx"), "utf8")
  const specs = readFileSync(resolve(process.cwd(), "app/(dashboard)/specifications/page.tsx"), "utf8")
  assert.match(dialog, /targetWeight/)
  assert.match(dialog, /role="dialog"/)
  assert.match(dialog, /spec-qc-stage-\$\{item\.key\}/)
  assert.match(dialog, /Stage basis:/)
  assert.match(dialog, /spec-qc-basis-\$\{stage\}-\$\{row\.code\}/)
  const measurement = readFileSync(resolve(process.cwd(), "lib/qc-measurement.ts"), "utf8")
  assert.match(measurement, /Height at winding/)
  assert.match(measurement, /Finished height/)
  assert.match(measurement, /NOT APPLICABLE/)
  assert.match(inventory, /PageHeader/)
  assert.match(logistics, /PageHeader/)
  assert.match(specs, /PageHeader/)
})

test("frozen stage rules expose allowed display fields", () => {
  const rules = frozenStageRules(
    { stages: { WINDER: { parameters: [{ code: "height", label: "Height", unit: "mm", min: 118, max: 122 }] } } },
    "WINDER",
  )
  const height = rules.find((row) => row.code === "height")
  assert.equal(formatAllowedRange(height), "Allowed: 118–122 mm")
})

test("signed inspection frozen rules and revision stay adjacent to the field", () => {
  const profileB = {
    revision: 2,
    stages: { WINDER: { parameters: [{ code: "id", label: "I.D.", unit: "mm", min: 10, max: 11 }] } },
  }
  const inspection = {
    profile_revision: 1,
    frozen_rules: [{ code: "id", label: "I.D.", unit: "mm", method: "Vernier", min: 76, max: 78 }],
  }
  const rules = inspectionFrozenRules(inspection, profileB, "WINDER")
  assert.equal(rules[0].max, 78)
  assert.equal(inspectionProfileRevision(inspection, profileB), 1)
  assert.match(qcFieldMeta(rules[0], { checkpoint: "Winding", revision: 1 }), /Unit mm/)
  assert.match(qcFieldMeta(rules[0], { checkpoint: "Winding", revision: 1 }), /Checkpoint Winding/)
  assert.match(qcFieldMeta(rules[0], { checkpoint: "Winding", revision: 1 }), /Rev 1/)
})

test("list actions follow missing/draft/pending/approved/retired and author/viewer/approver", () => {
  const specId = "spec-1"
  const missingAuthor = qcRowActions({ qcStatus: "missing", specId, canAuthor: true, canApprove: false })
  assert.deepEqual(missingAuthor.map((row) => row.label), ["Add quality parameters"])
  assert.equal(missingAuthor[0].href, "/specifications/spec-1/edit?qc=add")
  const missingViewer = qcRowActions({ qcStatus: "missing", specId, canAuthor: false, canApprove: false })
  assert.deepEqual(missingViewer.map((row) => row.label), ["View quality parameters"])
  const draftAuthor = qcRowActions({ qcStatus: "draft", specId, canAuthor: true, canApprove: true })
  assert.deepEqual(draftAuthor.map((row) => row.label), ["Complete quality setup"])
  const pendingApprover = qcRowActions({ qcStatus: "pending_review", specId, canAuthor: true, canApprove: true })
  assert.deepEqual(pendingApprover.map((row) => row.label), ["Review quality parameters"])
  const pendingViewer = qcRowActions({ qcStatus: "pending_review", specId, canAuthor: false, canApprove: false })
  assert.deepEqual(pendingViewer.map((row) => row.label), ["View pending"])
  const approvedAuthor = qcRowActions({ qcStatus: "approved", specId, canAuthor: true, canApprove: true })
  assert.deepEqual(approvedAuthor.map((row) => row.label), ["View quality parameters", "Create QC revision"])
  assert.equal(approvedAuthor[1].href, "/specifications/spec-1/edit?qc=revise")
  const retired = qcRowActions({
    qcStatus: "approved",
    specId,
    specStatus: "obsolete",
    active: false,
    canAuthor: true,
    canApprove: true,
  })
  assert.deepEqual(retired.map((row) => row.label), ["View quality parameters"])
  assert.equal(retired[0].href, "/specifications/spec-1")
  assert.equal(qcActionLabel("pending_review", { role: "approver" }), "Review quality parameters")
  assert.equal(qcActionLabel("pending_review", { role: "viewer" }), "View pending")
  const specsPage = readFileSync(resolve(process.cwd(), "app/(dashboard)/specifications/page.tsx"), "utf8")
  assert.match(specsPage, /qcRowActions/)
  assert.match(specsPage, /data-qc-action/)
})

if (failed.length) {
  for (const failure of failed) {
    console.error(`FAIL ${failure.name}`)
    console.error(failure.error)
  }
  process.exit(1)
}

console.log(`PASS ${passed.length}/${passed.length}`)
