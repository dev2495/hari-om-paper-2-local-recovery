/**
 * Canonical spec-math tests — TS mirror of
 * `hariom-erp/services/spec-service/tests/test_spec_math.py`.
 *
 * Run with sucrase-node (no extra deps):
 *   pnpm exec sucrase-node --transforms typescript,imports __tests__/spec-math.test.ts
 * or: `node --loader ./scripts/ts-loader.mjs __tests__/spec-math.test.ts` when a
 * proper test runner is added.
 */
import { strict as assert } from 'node:assert'

import {
  BAMBOO_CUT_LOSS_MM,
  BAMBOO_LENGTH_MAX_MM,
  BAMBOO_LENGTH_MIN_MM,
  BAMBOO_LENGTH_STEP_MM,
  DELTA_ABS_G,
  DELTA_PCT,
  GLOBAL_ADHESIVE_PERCENT,
  GLOBAL_MOISTURE_LOSS_PERCENT,
  GLOBAL_PARCHMENT_PERCENT,
  RECIPE_MAX_PAPERS,
  RECIPE_MAX_PLIES,
  RECIPE_MIN_PAPERS,
  type RecipePaper,
  buildBambooPlan,
  computePreview,
  expandPlies,
  perPlyWeightPerMm,
  plyGeometry,
  requiredPaperG,
  thicknessMm,
  validateRecipe,
  wetDryBreakdown,
} from '../lib/spec-math'

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
  assert.ok(
    Math.abs(actual - expected) <= Math.max(tol, Math.abs(expected) * tol),
    `expected ${actual} ≈ ${expected} (±${tol})`,
  )

// ----- constants -------------------------------------------------------------

test('defaults match workbook', () => {
  assert.equal(GLOBAL_ADHESIVE_PERCENT, 15.0)
  assert.equal(GLOBAL_PARCHMENT_PERCENT, 1.5)
  assert.equal(GLOBAL_MOISTURE_LOSS_PERCENT, 9.0)
  assert.equal(RECIPE_MIN_PAPERS, 3)
  assert.equal(RECIPE_MAX_PAPERS, 5)
  assert.equal(RECIPE_MAX_PLIES, 18)
  assert.equal(DELTA_ABS_G, 3.0)
  assert.equal(DELTA_PCT, 0.0)
  assert.equal(BAMBOO_LENGTH_MIN_MM, 1390)
  assert.equal(BAMBOO_LENGTH_MAX_MM, 1560)
  assert.equal(BAMBOO_LENGTH_STEP_MM, 10)
  assert.equal(BAMBOO_CUT_LOSS_MM, 40)
})

// ----- thickness -------------------------------------------------------------

test('thickness_mm basic cases', () => {
  approx(thicknessMm(250, 1.3), 0.325)
  approx(thicknessMm(300, 1.25), 0.375)
  approx(thicknessMm(350, 1.2), 0.42)
  approx(thicknessMm(237.5, 1.3), 0.30875)
  assert.equal(thicknessMm(0, 1.3), 0)
  assert.equal(thicknessMm(250, 0), 0)
})

// ----- expansion + geometry --------------------------------------------------

test('expandPlies preserves order and count', () => {
  const papers: RecipePaper[] = [
    { paper_id: 'a', gsm: 250, bulk: 1.3, ply_count: 2 },
    { paper_id: 'b', gsm: 300, bulk: 1.25, ply_count: 1 },
    { paper_id: 'c', gsm: 350, bulk: 1.2, ply_count: 1 },
  ]
  const out = expandPlies(papers)
  assert.deepEqual(
    out.map((p) => p.paper_id),
    ['a', 'a', 'b', 'c'],
  )
  assert.ok(out.every((p) => p.ply_count === 1))
})

test('plyGeometry single paper', () => {
  const expanded = expandPlies([{ paper_id: 'p', gsm: 250, bulk: 1.3, ply_count: 3 }])
  const { thicknesses, avg_dias, wall_mm } = plyGeometry(50, expanded)
  assert.deepEqual(
    thicknesses.map((t) => Math.round(t * 1000) / 1000),
    [0.325, 0.325, 0.325],
  )
  approx(avg_dias[0], 50.325)
  approx(avg_dias[1], 50.975)
  approx(avg_dias[2], 51.625)
  approx(wall_mm, 0.975)
})

test('plyGeometry multi-paper ordered inner to outer', () => {
  const thicknesses = plyGeometry(
    60,
    expandPlies([
      { paper_id: 'a', gsm: 250, bulk: 1.3, ply_count: 2 },
      { paper_id: 'b', gsm: 300, bulk: 1.25, ply_count: 1 },
    ]),
  )
  approx(thicknesses.avg_dias[0], 60.325)
  approx(thicknesses.avg_dias[1], 60.975)
  approx(thicknesses.avg_dias[2], 61.675)
  approx(thicknesses.wall_mm, 0.325 + 0.325 + 0.375)
})

// ----- per-mm weight ---------------------------------------------------------

test('perPlyWeightPerMm matches GSM circumference identity', () => {
  const gsm = 250
  const avgDia = 50
  const expected = (gsm * Math.PI * avgDia) / 1_000_000
  approx(perPlyWeightPerMm(gsm, avgDia), expected)
})

// ----- wet/dry ---------------------------------------------------------------

test('wetDryBreakdown defaults match workbook photo', () => {
  const b = wetDryBreakdown(100)
  approx(b.adhesive_g, 17.9641, 1e-4)
  approx(b.parchment_g, 1.7964, 1e-4)
  approx(b.wet_g, 119.7605, 1e-4)
  approx(b.dry_g, 119.7605 * 0.91, 1e-4)
})

test('wetDryBreakdown parchment disallowed', () => {
  const b = wetDryBreakdown(100, { parchment_allowed: false })
  assert.equal(b.parchment_g, 0)
  approx(b.wet_g, 117.6471, 1e-4)
})

test('wetDryBreakdown custom overrides', () => {
  const b = wetDryBreakdown(200, {
    adhesive_percent: 18,
    parchment_percent: 2,
    moisture_loss_percent: 10,
  })
  approx(b.wet_g, 250)
  approx(b.dry_g, 225)
})

// ----- required paper reverse -----------------------------------------------

test('requiredPaperG round-trip defaults', () => {
  const target = 250
  const req = requiredPaperG(target)
  approx(req, (target / 0.91) * 0.835, 1e-4)
  const back = wetDryBreakdown(req)
  approx(back.dry_g, target, 1e-3)
})

test('requiredPaperG zero/negative', () => {
  assert.equal(requiredPaperG(0), 0)
  assert.equal(requiredPaperG(-1), 0)
})

// ----- bamboo plan -----------------------------------------------------------

test('buildBambooPlan picks most tubes then least waste', () => {
  const plan = buildBambooPlan(150)
  assert.equal(plan.tubes_per_bamboo, 10)
  assert.equal(plan.trim_waste_mm, 0)
  assert.equal(plan.bamboo_length_mm, 1540)
})

test('buildBambooPlan tube longer than bamboo returns 0', () => {
  const plan = buildBambooPlan(2000)
  assert.equal(plan.tubes_per_bamboo, 0)
})

// ----- validation ------------------------------------------------------------

test('validateRecipe ok path', () => {
  const v = validateRecipe(
    [
      { paper_id: 'a', gsm: 250, bulk: 1.3, ply_count: 2 },
      { paper_id: 'b', gsm: 300, bulk: 1.25, ply_count: 1 },
      { paper_id: 'c', gsm: 350, bulk: 1.2, ply_count: 1 },
    ],
    250,
    250.5,
  )
  assert.equal(v.ok, true)
  assert.equal(v.distinct_papers, 3)
  assert.equal(v.total_plies, 4)
})

test('validateRecipe too few papers', () => {
  const v = validateRecipe(
    [
      { paper_id: 'a', gsm: 250, bulk: 1.3, ply_count: 2 },
      { paper_id: 'b', gsm: 300, bulk: 1.25, ply_count: 1 },
    ],
    250,
    250,
  )
  assert.equal(v.papers_ok, false)
  assert.equal(v.ok, false)
})

test('validateRecipe delta outside tolerance', () => {
  const v = validateRecipe(
    [
      { paper_id: 'a', gsm: 250, bulk: 1.3, ply_count: 2 },
      { paper_id: 'b', gsm: 300, bulk: 1.25, ply_count: 1 },
      { paper_id: 'c', gsm: 350, bulk: 1.2, ply_count: 1 },
    ],
    250,
    260,
  )
  assert.equal(v.delta_ok, false)
})

// ----- full preview ----------------------------------------------------------

test('computePreview end-to-end', () => {
  const p = computePreview({
    mandrel_od_mm: 62,
    tube_length_mm: 150,
    papers: [
      { paper_id: 'a', gsm: 250, bulk: 1.3, ply_count: 2 },
      { paper_id: 'b', gsm: 300, bulk: 1.25, ply_count: 1 },
      { paper_id: 'c', gsm: 350, bulk: 1.2, ply_count: 1 },
    ],
    target_dry_g: 250,
  })
  assert.equal(p.id_mm, 62)
  approx(p.wall_mm, 0.325 + 0.325 + 0.375 + 0.42, 1e-3)
  approx(p.od_mm, 62 + 2 * p.wall_mm, 1e-3)
  assert.ok(p.paper_weight_per_mm_g > 0)
  approx(p.tube.dry_g, p.tube.wet_g * (1 - GLOBAL_MOISTURE_LOSS_PERCENT / 100), 1e-3)
  approx(p.bamboo.paper_g / p.tube.paper_g, p.bamboo_plan.usable_length_mm / 150, 1e-3)
  assert.ok(
    p.bamboo_plan.bamboo_length_mm >= BAMBOO_LENGTH_MIN_MM &&
      p.bamboo_plan.bamboo_length_mm <= BAMBOO_LENGTH_MAX_MM,
  )
})

test('computePreview reverse matches wet/dry', () => {
  const target = 250
  const p = computePreview({
    mandrel_od_mm: 62,
    tube_length_mm: 150,
    papers: [
      { paper_id: 'a', gsm: 250, bulk: 1.3, ply_count: 2 },
      { paper_id: 'b', gsm: 300, bulk: 1.25, ply_count: 1 },
      { paper_id: 'c', gsm: 350, bulk: 1.2, ply_count: 1 },
    ],
    target_dry_g: target,
  })
  const back = wetDryBreakdown(p.paper_required_g)
  approx(back.dry_g, target, 1e-3)
})

test('computePreview respects parchment toggle', () => {
  const papers: RecipePaper[] = [{ paper_id: 'a', gsm: 250, bulk: 1.3, ply_count: 3 }]
  const base = computePreview({
    mandrel_od_mm: 62,
    tube_length_mm: 150,
    papers,
    target_dry_g: 100,
    parchment_allowed: true,
  })
  const no = computePreview({
    mandrel_od_mm: 62,
    tube_length_mm: 150,
    papers,
    target_dry_g: 100,
    parchment_allowed: false,
  })
  assert.equal(no.tube.parchment_g, 0)
  assert.ok(no.tube.wet_g < base.tube.wet_g)
})

test('computePreview respects custom globals', () => {
  const p = computePreview({
    mandrel_od_mm: 62,
    tube_length_mm: 150,
    papers: [{ paper_id: 'a', gsm: 250, bulk: 1.3, ply_count: 3 }],
    target_dry_g: 100,
    adhesive_percent: 18,
    parchment_percent: 2,
    moisture_loss_percent: 10,
  })
  approx(p.tube.adhesive_g, p.tube.wet_g * 0.18, 1e-3)
  approx(p.tube.parchment_g, p.tube.wet_g * 0.02, 1e-3)
  approx(p.tube.dry_g, p.tube.wet_g * 0.9, 1e-3)
})

// ----- report ----------------------------------------------------------------

console.log(`PASS ${passed.length}/${passed.length + failed.length}`)
for (const f of failed) {
  console.error(`FAIL ${f.name}`)
  console.error(f.error)
}
if (failed.length > 0) process.exit(1)
