export type ScalarDynamicField = {
  field_key: string
  label: string
  field_type: string
  required?: boolean
  options?: string[]
}

export type DynamicFieldValue = {
  field_key: string
  label?: string
  value?: string | null
  field_type?: string
}

export type ProfileRangeValue = {
  avg?: number | null
  min?: number | null
  max?: number | null
}

export type SpecProfile = {
  dimensions: {
    id_mm: ProfileRangeValue
    od_mm: ProfileRangeValue
    length_mm: ProfileRangeValue
    thickness_mm: ProfileRangeValue
    bamboo?: Record<string, any>
  }
  quality_targets: {
    tube_weight_g: ProfileRangeValue
    cs_n: ProfileRangeValue
    moisture_pct: ProfileRangeValue
    approved_cs?: number | null
  }
  recipe: {
    parchment_percent?: number | null
    parchment_groups?: string[]
    shrink_percent?: number | null
    adhesive_components?: AdhesiveComponent[]
    recipe_rows?: GroupedRecipeRow[]
  }
  notch_tooling: {
    notch_required?: boolean | null
    top_paper_required?: boolean | null
    notch_type?: string | null
    notch_distance_mm?: number | null
    notch_depth_mm?: number | null
    notching_holder?: string | null
    notching_blade?: string | null
    groove?: string | null
    punch?: string | null
    tochha?: string | null
    tochha_type?: string | null
    wider_tool?: string | null
    height_gauge_go?: number | null
    height_gauge_set?: number | null
    height_gauge_no_go?: number | null
    die?: string | null
    diagram?: Record<string, any>
  }
  process_guidance: {
    winder_target?: Record<string, any>
    oven_target?: Record<string, any>
    process_target?: Record<string, any>
  }
  packing_rules: {
    bundle_type?: string | null
    bundle_code?: string | null
    packing_ply?: number | null
    qty_per_box?: number | null
    packing_pcs?: number | null
    box_code?: string | null
    box_size?: string | null
    plastic_required?: boolean | null
    plastic_sku?: string | null
    plastic_per_box?: number | null
    fadda_sku?: string | null
    fadda_per_box?: number | null
    bopp_required?: boolean | null
    box?: string | null
    packing_target?: Record<string, any>
    instructions?: string | null
  }
}

export type SpecRecord = {
  id: string
  customer_id: string
  customer_name: string
  customer_name_snapshot: string
  tube_size_id: string
  mandrel_id: string
  spec_reference?: string | null
  required_cs: number
  approved_cs?: number | null
  target_tube_weight: number
  id_min_mm: number
  id_max_mm: number
  od_min_mm: number
  od_max_mm: number
  length_min_mm: number
  length_max_mm: number
  weight_min_g: number
  weight_max_g: number
  cs_min_n: number
  cs_max_n: number
  moisture_min_pct: number
  moisture_max_pct: number
  parchment_percent: number
  shrink_percent: number
  bamboo_max_length: number
  cut_loss_mm: number
  adhesive_20100_percent?: number | null
  adhesive_30100_percent?: number | null
  variant_template_key?: string | null
  profile?: SpecProfile
  status: string
  version: number
  active: boolean
  created_at: string
  dynamic_fields?: DynamicFieldValue[]
}

export type RecipeSummary = {
  id: string
  spec_id: string
  version: number
  status: string
  notes?: string | null
  plant_id: string
  created_at: string
}

export type RecipeLayer = {
  id?: string
  recipe_id?: string
  ply_no: number
  paper_id: string
  gsm_snapshot: number
  bf_snapshot: number
}

export type RecipeDetail = RecipeSummary & {
  layers: RecipeLayer[]
}

export type TrialRecord = {
  id: string
  recipe_id: string
  actual_cs?: number | null
  actual_weight?: number | null
  actual_shrink?: number | null
  remarks?: string | null
  approved: boolean
  tested_at: string
}

export type MasterOption = {
  id: string
  [key: string]: any
}

export type AverageValues = {
  id: number
  od: number
  length: number
  weight: number
  cs: number
  moisture: number
}

export type ToleranceBands = {
  id: number
  od: number
  length: number
  weightPct: number
  csPct: number
  moisture: number
}

export type GroupedRecipeRow = {
  id: string
  paper_id: string
  code: string
  variety: string
  category: string
  gsm: number
  bfPerPly: number
  thicknessPerPly: number
  plyBond: number
  plyCount: number
  adhesiveLabel: string
  positionsText: string
}

export type AdhesiveComponent = {
  name: string
  base_percent: number
  ratio_percent: number
}

export type RecipeSuggestion = {
  id: string
  title: string
  rows: GroupedRecipeRow[]
  predictedPaperWeightG: number
  deltaG: number
  predictedDryTubeG?: number
  predictedWetTubeG?: number
  deltaDryG?: number
  deltaWetG?: number
  totalPlyCount?: number
  preferredRule?: string
  recipeThicknessMm?: number
  effectiveDiameterMm?: number
}

export type ProcessGuidanceRow = {
  rh: string
  dryingPercent: number
  moistureBand: string
}

export const DEFAULT_MOISTURE_AVG = 8
export const DEFAULT_WET_DIVISOR = 0.905
export const DEFAULT_TOLERANCE_BANDS: ToleranceBands = {
  id: 0.5,
  od: 0.5,
  length: 2,
  weightPct: 3,
  csPct: 7,
  moisture: 1,
}

export const DEFAULT_PROCESS_GUIDANCE: ProcessGuidanceRow[] = []

export const DEFAULT_SPEC_FIELD_DEFINITIONS: ScalarDynamicField[] = [
  { field_key: "glue_mode", label: "Glue Mode", field_type: "select", options: ["workbook", "direct_ratio"] },
  { field_key: "glue_base_percent", label: "Glue Base %", field_type: "number" },
  { field_key: "allowed_parchment_groups_json", label: "Allowed Parchment Groups JSON", field_type: "text" },
  { field_key: "adhesive_components_json", label: "Adhesive Components JSON", field_type: "text" },
  { field_key: "drying_percent_override", label: "Drying Override %", field_type: "number" },
  { field_key: "fill_instructions_version", label: "Fill Instructions Version", field_type: "text" },
  { field_key: "notch_required", label: "Notch", field_type: "boolean" },
  { field_key: "top_paper_required", label: "Top Paper", field_type: "boolean" },
  {
    field_key: "notch_type",
    label: "Notch Type",
    field_type: "select",
    options: ["RHS - FORWARD", "LHS - FORWARD", "TOP - Forword Notch", "CENTER", "NONE"],
  },
  { field_key: "notch_distance_mm", label: "Notch Distance", field_type: "number" },
  { field_key: "notch_depth_mm", label: "Notch Depth", field_type: "number" },
  { field_key: "tochha", label: "Tochha", field_type: "select" },
  { field_key: "tochha_type", label: "Tochha Type", field_type: "select", options: ["LOWER", "UPPER", "STEP", "NONE", "Lower", "Upper"] },
  { field_key: "notching_holder", label: "Notching Holder", field_type: "select" },
  { field_key: "notching_blade", label: "Notching Blade", field_type: "select" },
  { field_key: "groove", label: "Groove", field_type: "select" },
  { field_key: "punch", label: "Punch", field_type: "select" },
  { field_key: "die", label: "Die", field_type: "select" },
  { field_key: "wider_tool", label: "Wider Tool", field_type: "select" },
  { field_key: "winder_tool_required", label: "Winder Tool", field_type: "boolean" },
  { field_key: "bundle_type", label: "Bundle Type", field_type: "text" },
  { field_key: "bundle_code", label: "Bundle Code", field_type: "text" },
  { field_key: "packing_ply", label: "Packing Ply", field_type: "number" },
  { field_key: "qty_per_box", label: "Qty / Box", field_type: "number" },
  { field_key: "packing_pcs", label: "Packing Pcs", field_type: "number" },
  { field_key: "box_code", label: "Box Code", field_type: "select" },
  { field_key: "box_size", label: "Box Size", field_type: "text" },
  { field_key: "plastic_required", label: "Plastic Required", field_type: "boolean" },
  { field_key: "plastic_sku", label: "Plastic SKU", field_type: "select" },
  { field_key: "plastic_per_box", label: "Plastic / Box", field_type: "number" },
  { field_key: "fadda_sku", label: "Fadda SKU", field_type: "select" },
  { field_key: "fadda_per_box", label: "Fadda / Box", field_type: "number" },
  { field_key: "bopp_required", label: "BOPP Required", field_type: "boolean" },
  { field_key: "special_instructions", label: "Packing Instructions", field_type: "text" },
  { field_key: "height_gauge_go", label: "Height Gauge GO", field_type: "number" },
  { field_key: "height_gauge_set", label: "Height Gauge SET", field_type: "number" },
  { field_key: "height_gauge_no_go", label: "Height Gauge NO GO", field_type: "number" },
  { field_key: "valid_upto", label: "Valid Upto", field_type: "text" },
  { field_key: "prepared_by", label: "Prepared By", field_type: "text" },
  { field_key: "prepared_date", label: "Prepared Date", field_type: "text" },
  { field_key: "sign_off_note", label: "Sign Off", field_type: "text" },
  { field_key: "recipe_sheet_json", label: "Recipe Sheet JSON", field_type: "text" },
  { field_key: "process_guidance_json", label: "Process Guidance JSON", field_type: "text" },
  { field_key: "manufacturing_override_json", label: "Manufacturing Override JSON", field_type: "text" },
  { field_key: "notch_diagram_json", label: "Notch Diagram JSON", field_type: "text" },
  { field_key: "winder_target_json", label: "Winder Target JSON", field_type: "text" },
  { field_key: "oven_target_json", label: "Oven Target JSON", field_type: "text" },
  { field_key: "process_target_json", label: "Process Target JSON", field_type: "text" },
  { field_key: "packing_target_json", label: "Packing Target JSON", field_type: "text" },
]

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

export function midpoint(min: number, max: number) {
  return Number(((Number(min) + Number(max)) / 2).toFixed(2))
}

export function roundValue(value: number, digits = 2) {
  return Number(Number(value || 0).toFixed(digits))
}

export function deriveRanges(avg: AverageValues, bands: ToleranceBands) {
  const id_min_mm = roundValue(avg.id - bands.id, 2)
  const id_max_mm = roundValue(avg.id + bands.id, 2)
  const od_min_mm = roundValue(avg.od - bands.od, 2)
  const od_max_mm = roundValue(avg.od + bands.od, 2)
  const length_min_mm = roundValue(avg.length - bands.length, 2)
  const length_max_mm = roundValue(avg.length + bands.length, 2)
  const weight_min_g = roundValue(avg.weight * (1 - bands.weightPct / 100), 2)
  const weight_max_g = roundValue(avg.weight * (1 + bands.weightPct / 100), 2)
  const cs_min_n = roundValue(avg.cs * (1 - bands.csPct / 100), 2)
  const cs_max_n = roundValue(avg.cs * (1 + bands.csPct / 100), 2)
  const moisture_min_pct = roundValue(clamp(avg.moisture - bands.moisture, 0, 100), 2)
  const moisture_max_pct = roundValue(clamp(avg.moisture + bands.moisture, 0, 100), 2)

  return {
    id_min_mm,
    id_max_mm,
    od_min_mm,
    od_max_mm,
    length_min_mm,
    length_max_mm,
    weight_min_g,
    weight_max_g,
    cs_min_n,
    cs_max_n,
    moisture_min_pct,
    moisture_max_pct,
  }
}

export function thicknessFrom(id: number, od: number) {
  return roundValue((Number(od || 0) - Number(id || 0)) / 2, 2)
}

export function parseDynamicFields(values?: DynamicFieldValue[]) {
  const map: Record<string, string> = {}
  for (const value of values || []) {
    map[value.field_key] = value.value == null ? "" : String(value.value)
  }
  return map
}

export function buildDynamicFieldsPayload(values: Record<string, string>) {
  return Object.entries(values).map(([field_key, raw]) => {
    const normalized = raw == null ? "" : String(raw)
    return {
      field_key,
      value: normalized.trim() === "" ? null : normalized,
    }
  })
}

export function parseJsonField<T>(value: string | undefined, fallback: T): T {
  if (!value) return fallback
  try {
    const parsed = JSON.parse(value)
    return parsed as T
  } catch {
    return fallback
  }
}

export function stringifyJsonField(value: unknown) {
  return JSON.stringify(value)
}

export function parsePlyPositions(value: string, fallbackCount = 1) {
  const cleaned = (value || "").trim()
  if (!cleaned) {
    return Array.from({ length: Math.max(1, fallbackCount) }, (_, index) => index + 1)
  }

  const positions = cleaned
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((part) => Number.isFinite(part) && part > 0)

  if (positions.length > 0) {
    return Array.from(new Set(positions)).sort((a, b) => a - b)
  }

  return Array.from({ length: Math.max(1, fallbackCount) }, (_, index) => index + 1)
}

export function encodePlyPositions(positions: number[]) {
  return positions.join(",")
}

export function buildGroupedRowLabel(paper: any) {
  if (!paper) return { code: "", variety: "", category: "" }
  return {
    code: String(paper.code || String(paper.id || "").slice(0, 8).toUpperCase()),
    variety: String(paper.variety || paper.category || `GSM ${paper.gsm}`),
    category: paper.category || "PAPER",
  }
}

function paperWeightPerPlyG(paper: any, tubeLengthMm: number, idMm: number, odMm: number) {
  const gsm = Number(paper?.gsm || 0)
  if (gsm <= 0 || tubeLengthMm <= 0) return 0
  const effectiveDiameterMm = Math.max((Number(idMm || 0) + Number(odMm || 0)) / 2, 1)
  return (3.14 * effectiveDiameterMm * tubeLengthMm * gsm) / 1_000_000
}

function paperThicknessMm(paper: any) {
  const explicit = Number(paper?.thickness_mm || 0)
  if (explicit > 0) return explicit
  const gsm = Number(paper?.gsm || 0)
  const bulk = Number(paper?.bulk_factor || 1.4)
  return gsm > 0 ? (gsm * bulk) / 1000 : 0
}

function comboRecipeThicknessMm(rows: GroupedRecipeRow[]) {
  return rows.reduce((sum, row) => sum + Number(row.thicknessPerPly || 0) * Number(row.plyCount || 0), 0)
}

function comboEffectiveDiameterMm(idMm: number, rows: GroupedRecipeRow[], fallbackOdMm: number) {
  const recipeThickness = comboRecipeThicknessMm(rows)
  if (recipeThickness > 0) return Math.max(Number(idMm || 0) + recipeThickness, 1)
  return Math.max((Number(idMm || 0) + Number(fallbackOdMm || 0)) / 2, 1)
}

function evaluateRecipeSuggestion(rows: GroupedRecipeRow[], tubeLengthMm: number, idMm: number, odMm: number, targetWetWeightG: number) {
  const effectiveDiameterMm = comboEffectiveDiameterMm(idMm, rows, odMm)
  const predictedPaperWeightG = rows.reduce((sum, row) => {
    const gsm = Number((row as any).gsm || 0)
    return sum + paperWeightPerPlyG({ gsm }, tubeLengthMm, effectiveDiameterMm, effectiveDiameterMm) * Number(row.plyCount || 0)
  }, 0)
  const predictedDryTubeG = predictedPaperWeightG * (1 + 0.15 + 0.015)
  const predictedWetTubeG = predictedDryTubeG / DEFAULT_WET_DIVISOR
  const targetDryWeightG = targetWetWeightG * DEFAULT_WET_DIVISOR
  return {
    recipeThicknessMm: roundValue(comboRecipeThicknessMm(rows), 4),
    effectiveDiameterMm: roundValue(effectiveDiameterMm, 4),
    predictedPaperWeightG: roundValue(predictedPaperWeightG, 2),
    predictedDryTubeG: roundValue(predictedDryTubeG, 2),
    predictedWetTubeG: roundValue(predictedWetTubeG, 2),
    deltaDryG: roundValue(predictedDryTubeG - targetDryWeightG, 2),
    deltaWetG: roundValue(predictedWetTubeG - targetWetWeightG, 2),
  }
}

function isGsmBand(paper: any, min: number, max: number) {
  const gsm = Number(paper?.gsm || 0)
  return gsm >= min && gsm <= max
}

function paperPriority(paper: any) {
  return Number(paper?.bf || paper?.ply_bond || 0)
}

function rowFromPaper(paper: any, plyCount: number, seed: string): GroupedRecipeRow {
  const label = buildGroupedRowLabel(paper)
  return {
    id: `sg-${seed}`,
    paper_id: String(paper?.id || ""),
    code: label.code,
    variety: label.variety,
    category: label.category,
    gsm: Number(paper?.gsm || 0),
    bfPerPly: Number(paper?.bf ?? 0),
    thicknessPerPly: Number(paper?.thickness_mm || 0),
    plyBond: Number(paper?.ply_bond || 0),
    plyCount: Math.max(1, Math.floor(plyCount || 1)),
    adhesiveLabel: "TL-4",
    positionsText: "",
  }
}

export function parseAdhesiveComponents(value: string | undefined, fallbackBasePercent = 15): AdhesiveComponent[] {
  const parsed = parseJsonField<unknown>(value, [])
  if (Array.isArray(parsed)) {
    const normalized = parsed
      .map((item) => {
        if (!item || typeof item !== "object") return null
        const source = item as Record<string, unknown>
        const name = String(source.name || source.label || "").trim()
        const base_percent = Number(source.base_percent ?? fallbackBasePercent)
        const ratio_percent = Number(source.ratio_percent ?? 0)
        if (!name || !Number.isFinite(base_percent) || !Number.isFinite(ratio_percent)) return null
        if (base_percent <= 0 || ratio_percent <= 0) return null
        return { name, base_percent, ratio_percent }
      })
      .filter((item): item is AdhesiveComponent => Boolean(item))
    if (normalized.length > 0) return normalized.slice(0, 5)
  }
  return []
}

export function buildAdhesiveComponentsPayload(
  components: AdhesiveComponent[],
  fallback: { tl4?: number; vinsol?: number; basePercent?: number } = {},
) {
  const normalized = components
    .filter((item) => Number(item.base_percent) > 0 && Number(item.ratio_percent) > 0 && item.name.trim().length > 0)
    .slice(0, 5)

  if (normalized.length > 0) return normalized

  const basePercent = Number(fallback.basePercent ?? 15)
  const tl4 = Number(fallback.tl4 ?? 0)
  const vinsol = Number(fallback.vinsol ?? 0)
  const legacy: AdhesiveComponent[] = []
  if (tl4 > 0) legacy.push({ name: "TL4(Vinsol) / 20100", base_percent: basePercent, ratio_percent: tl4 })
  if (vinsol > 0) legacy.push({ name: "Alcosol / 30100", base_percent: basePercent, ratio_percent: vinsol })
  return legacy
}

export function suggestRecipeRowsFromPapers(
  papers: any[],
  targetWetWeightG: number,
  tubeLengthMm: number,
  idMm: number,
  odMm: number,
): RecipeSuggestion[] {
  const activePapers = (papers || []).filter((paper) => Number(paper?.gsm || 0) > 0)
  if (!activePapers.length || targetWetWeightG <= 0 || tubeLengthMm <= 0) return []

  const targetDryWeightG = targetWetWeightG * DEFAULT_WET_DIVISOR
  const targetPaperWeightG = targetDryWeightG / (1 + 0.15 + 0.015)
  const candidates = activePapers
    .map((paper) => {
      const roughEffectiveDiameterMm = Math.max((Number(idMm || 0) + Number(odMm || 0)) / 2, Number(idMm || 0) + paperThicknessMm(paper), 1)
      return {
        paper,
        roughPerPly: paperWeightPerPlyG({ gsm: Number(paper?.gsm || 0) }, tubeLengthMm, roughEffectiveDiameterMm, roughEffectiveDiameterMm),
      }
    })
    .filter((item) => item.roughPerPly > 0)
    .sort((a, b) => a.roughPerPly - b.roughPerPly)

  const suggestions = new Map<string, RecipeSuggestion>()

  function registerSuggestion(id: string, title: string, rows: GroupedRecipeRow[], preferredRule?: string) {
    const evaluation = evaluateRecipeSuggestion(rows, tubeLengthMm, idMm, odMm, targetWetWeightG)
    const normalizedTitle = preferredRule ? `${preferredRule === "2x250 + 1x300 + best remainder" ? "250/300 locked · " : ""}${title}` : title
    const suggestion: RecipeSuggestion = {
      id,
      title: normalizedTitle,
      rows,
      preferredRule,
      predictedPaperWeightG: evaluation.predictedPaperWeightG,
      predictedDryTubeG: evaluation.predictedDryTubeG,
      predictedWetTubeG: evaluation.predictedWetTubeG,
      deltaDryG: evaluation.deltaDryG,
      deltaWetG: evaluation.deltaWetG,
      deltaG: evaluation.deltaDryG,
      totalPlyCount: rows.reduce((sum, row) => sum + Number(row.plyCount || 0), 0),
      recipeThicknessMm: evaluation.recipeThicknessMm,
      effectiveDiameterMm: evaluation.effectiveDiameterMm,
    }
    const signature = rows
      .slice()
      .sort((left, right) => `${left.paper_id}:${left.plyCount}`.localeCompare(`${right.paper_id}:${right.plyCount}`))
      .map((row) => `${row.paper_id}:${row.plyCount}`)
      .join("|")
    const existing = suggestions.get(signature)
    if (!existing) {
      suggestions.set(signature, suggestion)
      return
    }
    const existingScore = [existing.preferredRule ? 0 : 1, Math.abs(existing.deltaDryG || 0), Math.abs(existing.deltaWetG || 0), existing.totalPlyCount || 999]
    const nextScore = [suggestion.preferredRule ? 0 : 1, Math.abs(suggestion.deltaDryG || 0), Math.abs(suggestion.deltaWetG || 0), suggestion.totalPlyCount || 999]
    for (let index = 0; index < nextScore.length; index += 1) {
      if (nextScore[index] < existingScore[index]) {
        suggestions.set(signature, suggestion)
        return
      }
      if (nextScore[index] > existingScore[index]) return
    }
  }

  const preferred250 = candidates
    .filter((item) => isGsmBand(item.paper, 245, 255))
    .sort((left, right) => paperPriority(right.paper) - paperPriority(left.paper))
  const preferred300 = candidates
    .filter((item) => isGsmBand(item.paper, 295, 310))
    .sort((left, right) => paperPriority(right.paper) - paperPriority(left.paper))
  const preferredRemainder = candidates
    .filter((item) => Number(item.paper?.gsm || 0) >= 340)
    .sort((left, right) => paperPriority(right.paper) - paperPriority(left.paper))

  if (preferred250.length && preferred300.length) {
    for (const locked250 of preferred250.slice(0, 2)) {
      for (const locked300 of preferred300.slice(0, 2)) {
        const lockedRows = [
          rowFromPaper(locked250.paper, 2, `locked-250-${locked250.paper.id}`),
          rowFromPaper(locked300.paper, 1, `locked-300-${locked300.paper.id}`),
        ]
        const lockedWeight = locked250.roughPerPly * 2 + locked300.roughPerPly
        const fallbackPool = preferredRemainder.length ? preferredRemainder : candidates.filter((item) => item.paper?.id !== locked250.paper?.id && item.paper?.id !== locked300.paper?.id)

        if (!fallbackPool.length) {
          registerSuggestion(
            `locked-${locked250.paper.id}-${locked300.paper.id}`,
            lockedRows.map((row) => `${row.code} x ${row.plyCount}`).join(" + "),
            lockedRows,
            "2x250 + 1x300",
          )
          continue
        }

        for (const extra of fallbackPool.slice(0, 3)) {
          const estExtra = Math.max(0, Math.round((targetPaperWeightG - lockedWeight) / Math.max(extra.roughPerPly, 0.0001)))
          for (let extraPly = Math.max(0, estExtra - 1); extraPly <= estExtra + 2; extraPly += 1) {
            const rows = [
              ...lockedRows,
              ...(extraPly > 0 ? [rowFromPaper(extra.paper, extraPly, `locked-extra-${extra.paper.id}`)] : []),
            ]
            registerSuggestion(
              `locked-${locked250.paper.id}-${locked300.paper.id}-${extra.paper.id}-${extraPly}`,
              rows.map((row) => `${row.code} x ${row.plyCount}`).join(" + "),
              rows,
              "2x250 + 1x300 + best remainder",
            )
          }
        }
      }
    }
  }

  // Single-paper suggestions.
  for (const candidate of candidates.slice(0, 5)) {
    const plyCount = Math.max(1, Math.round(targetPaperWeightG / candidate.roughPerPly))
    const row = rowFromPaper(candidate.paper, plyCount, `single-${candidate.paper.id}`)
    registerSuggestion(`single-${candidate.paper.id}`, `${row.variety} x ${plyCount} ply`, [row])
  }

  // Two-paper blended suggestions.
  for (let i = 0; i < Math.min(candidates.length, 4); i++) {
    for (let j = i + 1; j < Math.min(candidates.length, 6); j++) {
      const left = candidates[i]
      const right = candidates[j]
      const approxPly = Math.max(2, Math.round(targetPaperWeightG / ((left.roughPerPly + right.roughPerPly) / 2)))
      const leftPly = Math.max(1, Math.floor(approxPly / 2))
      const rightPly = Math.max(1, approxPly - leftPly)
      const rows = [
        rowFromPaper(left.paper, leftPly, `mix-a-${left.paper.id}-${right.paper.id}`),
        rowFromPaper(right.paper, rightPly, `mix-b-${left.paper.id}-${right.paper.id}`),
      ]
      registerSuggestion(`mix-${left.paper.id}-${right.paper.id}`, `${rows[0].variety} + ${rows[1].variety}`, rows)
    }
  }

  return Array.from(suggestions.values())
    .sort((a, b) => {
      const leftPreferred = a.preferredRule ? 0 : 1
      const rightPreferred = b.preferredRule ? 0 : 1
      if (leftPreferred !== rightPreferred) return leftPreferred - rightPreferred
      if (Math.abs(a.deltaDryG || 0) !== Math.abs(b.deltaDryG || 0)) return Math.abs(a.deltaDryG || 0) - Math.abs(b.deltaDryG || 0)
      if (Math.abs(a.deltaWetG || 0) !== Math.abs(b.deltaWetG || 0)) return Math.abs(a.deltaWetG || 0) - Math.abs(b.deltaWetG || 0)
      return (a.totalPlyCount || 999) - (b.totalPlyCount || 999)
    })
    .slice(0, 6)
}
