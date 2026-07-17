/**
 * Canonical spec-sheet math — TypeScript mirror.
 *
 * Mirror of `hariom-erp/services/spec-service/src/spec_math.py`. Any change
 * here must be ported there and covered on both sides. See
 * `IMPLEMENTATION.md` in the repo root for the formula reference.
 */

// ---------------------------------------------------------------------------
// Constants (defaults; per-spec overrides allowed in the Validation footer)
// ---------------------------------------------------------------------------

export const GLOBAL_ADHESIVE_PERCENT = 15.0
export const GLOBAL_PARCHMENT_PERCENT = 1.5
export const GLOBAL_MOISTURE_LOSS_PERCENT = 9.0

export const BAMBOO_LENGTH_MIN_MM = 1390
export const BAMBOO_LENGTH_MAX_MM = 1560
export const BAMBOO_LENGTH_STEP_MM = 10
export const BAMBOO_CUT_LOSS_MM = 40

export const MANDREL_TOLERANCE_MM = 0.1

export const RECIPE_MIN_PAPERS = 1
export const RECIPE_MAX_PAPERS = 10
export const RECIPE_MAX_PLIES = 25

export const DELTA_ABS_G = 3.0
export const DELTA_PCT = 0.0

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RecipePaper = {
  paper_id: string
  gsm: number
  bulk: number
  ply_count: number
  code?: string
}

export type WeightBreakdown = {
  paper_g: number
  adhesive_g: number
  parchment_g: number
  wet_g: number
  dry_g: number
}

export type BambooPlan = {
  bamboo_length_mm: number
  tubes_per_bamboo: number
  trim_waste_mm: number
  usable_length_mm: number
  finished_length_mm: number
  fixed_end_trim_mm: number
  residual_offcut_mm: number
  total_trim_mm: number
}

export type RecipeValidation = {
  distinct_papers: number
  total_plies: number
  papers_ok: boolean
  plies_ok: boolean
  delta_g: number
  delta_tolerance_g: number
  delta_ok: boolean
  ok: boolean
}

export type PreviewResult = {
  id_mm: number
  mandrel_tolerance_mm: number
  od_mm: number
  wall_mm: number
  per_ply_thickness_mm: number[]
  per_ply_avg_dia_mm: number[]
  per_ply_weight_per_mm_g: number[]
  target_per_ply_weight_per_mm_g: number[]
  paper_weight_per_mm_g: number
  target_paper_weight_per_mm_g: number
  tube: WeightBreakdown
  nominal_tube: WeightBreakdown
  bamboo: WeightBreakdown
  bamboo_trim: WeightBreakdown
  whole_bamboo: WeightBreakdown
  bamboo_plan: BambooPlan
  paper_required_g: number
  paper_calibration_factor: number
  validation: RecipeValidation
}

export type PreviewOptions = {
  mandrel_od_mm: number
  tube_length_mm: number
  papers: RecipePaper[]
  target_dry_g: number
  adhesive_percent?: number
  parchment_percent?: number
  moisture_loss_percent?: number
  parchment_allowed?: boolean
}

// ---------------------------------------------------------------------------
// Core formulas
// ---------------------------------------------------------------------------

const round4 = (n: number) => Math.round(n * 10_000) / 10_000
const round6 = (n: number) => Math.round(n * 1_000_000) / 1_000_000
const clamp0 = (n: number | null | undefined) =>
  typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0
const dryDivisor = (moistureLossPercent: number) => Math.max(1 - Math.max(moistureLossPercent, 0) / 100, 0.0001)
const addOnShare = (adhesivePercent: number, parchmentPercent: number, parchmentAllowed: boolean) =>
  Math.max(adhesivePercent, 0) / 100 + (parchmentAllowed ? Math.max(parchmentPercent, 0) / 100 : 0)

export function thicknessMm(gsm: number, bulk: number): number {
  return (clamp0(gsm) * clamp0(bulk)) / 1000
}

export function expandPlies(papers: readonly RecipePaper[]): RecipePaper[] {
  const out: RecipePaper[] = []
  for (const p of papers) {
    const count = Math.max(Math.floor(p.ply_count || 0), 0)
    for (let i = 0; i < count; i++) {
      out.push({
        paper_id: p.paper_id,
        gsm: p.gsm,
        bulk: p.bulk,
        ply_count: 1,
        code: p.code,
      })
    }
  }
  return out
}

export function plyGeometry(
  idMm: number,
  expanded: readonly RecipePaper[],
): { thicknesses: number[]; avg_dias: number[]; wall_mm: number } {
  const thicknesses: number[] = []
  const avg_dias: number[] = []
  let cumulativeInner = 0
  for (const p of expanded) {
    const t = thicknessMm(p.gsm, p.bulk)
    const innerD = idMm + 2 * cumulativeInner
    const avgD = innerD + t // (inner + (inner + 2t)) / 2 = inner + t
    thicknesses.push(t)
    avg_dias.push(avgD)
    cumulativeInner += t
  }
  return { thicknesses, avg_dias, wall_mm: cumulativeInner }
}

export function perPlyWeightPerMm(gsm: number, avgDiaMm: number): number {
  return (clamp0(gsm) * Math.PI * clamp0(avgDiaMm)) / 1_000_000
}

export function wetDryBreakdown(
  paperG: number,
  opts?: {
    adhesive_percent?: number
    parchment_percent?: number
    moisture_loss_percent?: number
    parchment_allowed?: boolean
    target_dry_g?: number
  },
): WeightBreakdown {
  const paper = clamp0(paperG)
  const A = opts?.adhesive_percent ?? GLOBAL_ADHESIVE_PERCENT
  const P = opts?.parchment_percent ?? GLOBAL_PARCHMENT_PERCENT
  const M = opts?.moisture_loss_percent ?? GLOBAL_MOISTURE_LOSS_PERCENT
  const parchmentAllowed = opts?.parchment_allowed ?? true
  const targetDry = clamp0(opts?.target_dry_g)
  const divisor = dryDivisor(M)
  const addon = addOnShare(A, P, parchmentAllowed)
  const dryBase = targetDry > 0 ? targetDry : (paper * divisor) / Math.max(1 - divisor * addon, 0.0001)
  const adhesive = (dryBase * Math.max(A, 0)) / 100
  const parchment = parchmentAllowed ? (dryBase * Math.max(P, 0)) / 100 : 0
  const wet = paper + adhesive + parchment
  const dry = wet * divisor
  return {
    paper_g: round4(paper),
    adhesive_g: round4(adhesive),
    parchment_g: round4(parchment),
    wet_g: round4(wet),
    dry_g: round4(dry),
  }
}

export function scaleBreakdown(breakdown: WeightBreakdown, factor: number): WeightBreakdown {
  const scale = Math.max(Number.isFinite(factor) ? factor : 0, 0)
  return {
    paper_g: round4(breakdown.paper_g * scale),
    adhesive_g: round4(breakdown.adhesive_g * scale),
    parchment_g: round4(breakdown.parchment_g * scale),
    wet_g: round4(breakdown.wet_g * scale),
    dry_g: round4(breakdown.dry_g * scale),
  }
}

export function requiredPaperG(
  targetDryG: number,
  opts?: {
    adhesive_percent?: number
    parchment_percent?: number
    moisture_loss_percent?: number
    parchment_allowed?: boolean
  },
): number {
  if (!targetDryG || targetDryG <= 0) return 0
  const A = opts?.adhesive_percent ?? GLOBAL_ADHESIVE_PERCENT
  const P = opts?.parchment_percent ?? GLOBAL_PARCHMENT_PERCENT
  const M = opts?.moisture_loss_percent ?? GLOBAL_MOISTURE_LOSS_PERCENT
  const parchmentAllowed = opts?.parchment_allowed ?? true
  const divisor = dryDivisor(M)
  const targetWet = targetDryG / divisor
  const adhesive = (targetDryG * Math.max(A, 0)) / 100
  const parchment = parchmentAllowed ? (targetDryG * Math.max(P, 0)) / 100 : 0
  return round4(Math.max(targetWet - adhesive - parchment, 0))
}

// ---------------------------------------------------------------------------
// Bamboo plan
// ---------------------------------------------------------------------------

export function buildBambooPlan(
  tubeLengthMm: number,
  opts?: {
    min_length_mm?: number
    max_length_mm?: number
    step_mm?: number
    cut_loss_mm?: number
  },
): BambooPlan {
  const tubeLen = Math.max(Math.round(tubeLengthMm), 1)
  const min = opts?.min_length_mm ?? BAMBOO_LENGTH_MIN_MM
  const max = opts?.max_length_mm ?? BAMBOO_LENGTH_MAX_MM
  const step = opts?.step_mm ?? BAMBOO_LENGTH_STEP_MM
  const cut = opts?.cut_loss_mm ?? BAMBOO_CUT_LOSS_MM
  let best: BambooPlan | null = null
  for (let L = max; L >= min; L -= step) {
    const usable = Math.max(L - cut, 0)
    const tubes = tubeLen > 0 ? Math.floor(usable / tubeLen) : 0
    const waste = usable - tubes * tubeLen
    const candidate: BambooPlan = {
      bamboo_length_mm: L,
      tubes_per_bamboo: tubes,
      trim_waste_mm: waste,
      usable_length_mm: usable,
      finished_length_mm: tubes * tubeLen,
      fixed_end_trim_mm: Math.min(Math.max(cut, 0), L),
      residual_offcut_mm: waste,
      total_trim_mm: Math.max(L - tubes * tubeLen, 0),
    }
    if (!best) {
      best = candidate
      continue
    }
    if (candidate.tubes_per_bamboo > best.tubes_per_bamboo) best = candidate
    else if (
      candidate.tubes_per_bamboo === best.tubes_per_bamboo &&
      candidate.trim_waste_mm < best.trim_waste_mm
    )
      best = candidate
  }
  return best!
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function validateRecipe(
  papers: readonly RecipePaper[],
  targetDryG: number,
  predictedDryG: number,
): RecipeValidation {
  const distinct = new Set<string>()
  let totalPlies = 0
  for (const p of papers) {
    const count = Math.max(Math.floor(p.ply_count || 0), 0)
    if (count > 0) distinct.add(p.paper_id)
    totalPlies += count
  }
  const papers_ok = distinct.size >= RECIPE_MIN_PAPERS && distinct.size <= RECIPE_MAX_PAPERS
  const plies_ok = totalPlies >= 1 && totalPlies <= RECIPE_MAX_PLIES
  const delta = (predictedDryG || 0) - (targetDryG || 0)
  const tol = DELTA_ABS_G
  const delta_ok = Math.abs(delta) <= tol
  return {
    distinct_papers: distinct.size,
    total_plies: totalPlies,
    papers_ok,
    plies_ok,
    delta_g: round4(delta),
    delta_tolerance_g: round4(tol),
    delta_ok,
    ok: papers_ok && plies_ok && delta_ok,
  }
}

// ---------------------------------------------------------------------------
// Top-level orchestration
// ---------------------------------------------------------------------------

export function computePreview(opts: PreviewOptions): PreviewResult {
  const id_mm = clamp0(opts.mandrel_od_mm)
  const tube_length_mm = clamp0(opts.tube_length_mm)
  const adhesive_percent = opts.adhesive_percent ?? GLOBAL_ADHESIVE_PERCENT
  const parchment_percent = opts.parchment_percent ?? GLOBAL_PARCHMENT_PERCENT
  const moisture_loss_percent = opts.moisture_loss_percent ?? GLOBAL_MOISTURE_LOSS_PERCENT
  const parchment_allowed = opts.parchment_allowed ?? true

  const expanded = expandPlies(opts.papers)
  const { thicknesses, avg_dias, wall_mm } = plyGeometry(id_mm, expanded)
  const per_ply_wpm = expanded.map((p, i) => perPlyWeightPerMm(p.gsm, avg_dias[i]))
  const paper_wpm = per_ply_wpm.reduce((a, b) => a + b, 0)
  const od_mm = id_mm + 2 * wall_mm

  const nominal_tube_paper_g = paper_wpm * tube_length_mm
  const nominal_tube = wetDryBreakdown(nominal_tube_paper_g, {
    adhesive_percent,
    parchment_percent,
    moisture_loss_percent,
    parchment_allowed,
    target_dry_g: opts.target_dry_g,
  })

  const required = requiredPaperG(opts.target_dry_g, {
    adhesive_percent,
    parchment_percent,
    moisture_loss_percent,
    parchment_allowed,
  })
  const has_recipe = nominal_tube_paper_g > 0 && expanded.length > 0
  // A selected paper recipe is physical truth. Target weight is a comparison
  // benchmark and must never scale GSM/geometry-derived paper consumption.
  const paper_calibration_factor = has_recipe ? 1 : 0
  const target_per_ply_wpm = [...per_ply_wpm]
  const target_paper_wpm = target_per_ply_wpm.reduce((sum, weight) => sum + weight, 0)
  const tube = has_recipe
    ? wetDryBreakdown(nominal_tube_paper_g, {
        adhesive_percent,
        parchment_percent,
        moisture_loss_percent,
        parchment_allowed,
        target_dry_g: opts.target_dry_g,
      })
    : { paper_g: 0, adhesive_g: 0, parchment_g: 0, wet_g: 0, dry_g: 0 }

  const plan = buildBambooPlan(tube_length_mm || 1)
  const tube_basis_mm = Math.max(tube_length_mm, 1)
  const bamboo = scaleBreakdown(tube, plan.tubes_per_bamboo)
  const bamboo_trim = scaleBreakdown(tube, plan.total_trim_mm / tube_basis_mm)
  const whole_bamboo = scaleBreakdown(tube, plan.bamboo_length_mm / tube_basis_mm)

  const validation = validateRecipe(opts.papers, opts.target_dry_g || 0, tube.dry_g)

  return {
    id_mm: round4(id_mm),
    mandrel_tolerance_mm: MANDREL_TOLERANCE_MM,
    od_mm: round4(od_mm),
    wall_mm: round4(wall_mm),
    per_ply_thickness_mm: thicknesses.map(round4),
    per_ply_avg_dia_mm: avg_dias.map(round4),
    per_ply_weight_per_mm_g: per_ply_wpm.map(round6),
    target_per_ply_weight_per_mm_g: target_per_ply_wpm.map(round6),
    paper_weight_per_mm_g: round6(paper_wpm),
    target_paper_weight_per_mm_g: round6(target_paper_wpm),
    tube,
    nominal_tube,
    bamboo,
    bamboo_trim,
    whole_bamboo,
    bamboo_plan: plan,
    paper_required_g: required,
    paper_calibration_factor: round6(paper_calibration_factor),
    validation,
  }
}
