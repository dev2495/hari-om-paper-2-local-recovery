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
  assert.equal(RECIPE_MIN_PAPERS, 1)
  assert.equal(RECIPE_MAX_PAPERS, 10)
  assert.equal(RECIPE_MAX_PLIES, 25)
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

test('wetDryBreakdown defaults use dry-weight adhesive and parchment', () => {
  const b = wetDryBreakdown(233.4753, { target_dry_g: 250 })
  approx(b.adhesive_g, 37.5, 1e-4)
  approx(b.parchment_g, 3.75, 1e-4)
  approx(b.wet_g, 274.7253, 1e-4)
  approx(b.dry_g, 250, 1e-3)
})

test('wetDryBreakdown keeps additives fixed to client dry target when recipe is off', () => {
  const b = wetDryBreakdown(247.69, { target_dry_g: 250 })
  approx(b.adhesive_g, 37.5, 1e-4)
  approx(b.parchment_g, 3.75, 1e-4)
  approx(b.wet_g, 288.94, 1e-4)
  approx(b.dry_g, 262.9354, 1e-4)
})

test('wetDryBreakdown parchment disallowed', () => {
  const b = wetDryBreakdown(94.8901, { parchment_allowed: false, target_dry_g: 100 })
  assert.equal(b.parchment_g, 0)
  approx(b.adhesive_g, 15, 1e-4)
  approx(b.wet_g, 109.8901, 1e-4)
  approx(b.dry_g, 100, 1e-3)
})

test('wetDryBreakdown custom overrides', () => {
  const b = wetDryBreakdown(91.1111, {
    target_dry_g: 100,
    adhesive_percent: 18,
    parchment_percent: 2,
    moisture_loss_percent: 10,
  })
  approx(b.adhesive_g, 18)
  approx(b.parchment_g, 2)
  approx(b.wet_g, 111.1111, 1e-4)
  approx(b.dry_g, 100, 1e-3)
})

// ----- required paper reverse -----------------------------------------------

test('requiredPaperG round-trip defaults', () => {
  const target = 250
  const req = requiredPaperG(target)
  approx(req, target / 0.91 - target * 0.15 - target * 0.015, 1e-4)
  const back = wetDryBreakdown(req, { target_dry_g: target })
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

test('validateRecipe requires at least one paper', () => {
  const v = validateRecipe([], 250, 250)
  assert.equal(v.papers_ok, false)
  assert.equal(v.ok, false)
})

test('validateRecipe rejects more than twenty-five plies', () => {
  const v = validateRecipe(
    [
      { paper_id: 'a', gsm: 250, bulk: 1.3, ply_count: 10 },
      { paper_id: 'b', gsm: 300, bulk: 1.25, ply_count: 8 },
      { paper_id: 'c', gsm: 350, bulk: 1.2, ply_count: 8 },
    ],
    250,
    250,
  )
  assert.equal(v.total_plies, 26)
  assert.equal(v.plies_ok, false)
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
  const back = wetDryBreakdown(p.paper_required_g, { target_dry_g: target })
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
  assert.ok(no.paper_required_g > base.paper_required_g)
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
  approx(p.tube.adhesive_g, 18, 1e-3)
  approx(p.tube.parchment_g, 2, 1e-3)
  approx(p.tube.dry_g, p.tube.wet_g * 0.9, 1e-3)
})

test('production recipe keeps actual paper weights and compares them with target', () => {
  const p = computePreview({
    mandrel_od_mm: 125.55,
    tube_length_mm: 120,
    papers: [
      { paper_id: '230', gsm: 230, bulk: 1.3, ply_count: 3 },
      { paper_id: '301', gsm: 301, bulk: 1.4, ply_count: 1 },
      { paper_id: '355', gsm: 355, bulk: 1.4, ply_count: 5 },
      { paper_id: '351', gsm: 351, bulk: 1.45, ply_count: 5 },
    ],
    target_dry_g: 230,
  })

  approx(p.paper_required_g, 214.7973, 1e-4)
  approx(p.tube.paper_g, 224.613, 1e-4)
  approx(p.tube.wet_g, 262.563, 1e-4)
  approx(p.tube.dry_g, 238.9323, 1e-4)
  approx(p.validation.delta_g, 8.9323, 1e-4)
  approx(p.target_per_ply_weight_per_mm_g.reduce((sum, value) => sum + value, 0) * 120, 224.613, 1e-3)
  approx(p.paper_calibration_factor, 1, 1e-6)

  assert.equal(p.bamboo_plan.bamboo_length_mm, 1480)
  assert.equal(p.bamboo_plan.finished_length_mm, 1440)
  assert.equal(p.bamboo_plan.fixed_end_trim_mm, 40)
  assert.equal(p.bamboo_plan.residual_offcut_mm, 0)
  assert.equal(p.bamboo_plan.total_trim_mm, 40)
  approx(p.bamboo.wet_g, p.tube.wet_g * 12, 1e-3)
  approx(p.bamboo_trim.wet_g, p.tube.wet_g * 40 / 120, 1e-3)
  approx(p.whole_bamboo.wet_g, p.bamboo.wet_g + p.bamboo_trim.wet_g, 1e-3)
})

// ----- report ----------------------------------------------------------------

console.log(`PASS ${passed.length}/${passed.length + failed.length}`)
for (const f of failed) {
  console.error(`FAIL ${f.name}`)
  console.error(f.error)
}
if (failed.length > 0) process.exit(1)
