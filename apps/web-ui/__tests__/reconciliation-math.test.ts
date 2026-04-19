import { strict as assert } from "node:assert"

import { computeReconciliationBridge } from "../lib/reconciliation-math"

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

const approx = (actual: number, expected: number, tol = 1e-6) =>
  assert.ok(Math.abs(actual - expected) <= tol, `expected ${actual} ≈ ${expected}`)

test("month-close bridge treats wastage as absolute kg after moisture", () => {
  const result = computeReconciliationBridge({
    paperKg: 107,
    adhesiveKg: 15,
    parchmentKg: 1.5,
    moisturePercent: 9,
    wastageKg: 12,
    targetOutputKg: 100,
  })

  approx(result.grossWetKg, 123.5)
  approx(result.moistureLossKg, 11.115)
  approx(result.afterMoistureKg, 112.385)
  approx(result.finalOutputKg, 100.385)
  approx(result.varianceKg, 0.385)
  approx(result.wastagePercentOfDry, 10.67758, 1e-5)
})

test("exact paper required solves target output plus absolute wastage before moisture", () => {
  const result = computeReconciliationBridge({
    paperKg: 107,
    adhesiveKg: 15,
    parchmentKg: 1.5,
    moisturePercent: 9,
    wastageKg: 12,
    targetOutputKg: 100,
  })

  approx(result.targetWetBeforeMoistureKg, 112 / 0.91)
  approx(result.exactPaperRequiredKg, 106.5769230769, 1e-9)
})

if (failed.length) {
  for (const failure of failed) {
    console.error(`FAIL ${failure.name}`)
    console.error(failure.error)
  }
  process.exit(1)
}

console.log(`PASS ${passed.length}/${passed.length}`)
