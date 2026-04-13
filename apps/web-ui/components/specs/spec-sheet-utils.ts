export const STRICT_COMBO_MINIMUMS: Record<number, number> = { 250: 2, 300: 1 }
export const STRICT_COMBO_PREFERRED_MIN_GSM = 350
export const DEFAULT_DRYING_LOSS_PERCENT = 9.5
export const DEFAULT_PARCHMENT_PERCENT = 1.5
export const DEFAULT_ADHESIVE_PERCENT = 15
export const BAMBOO_MIN_LENGTH_MM = 1390
export const BAMBOO_MAX_LENGTH_MM = 1560
export const BAMBOO_INCREMENT_MM = 10
export const BAMBOO_CUT_LOSS_MM = 40

export type SpecEditorRecipeRow = {
  id: string
  paper_id: string
  code: string
  variety: string
  category: string
  gsm: number
  bf_per_ply: number
  thickness_per_ply: number
  ply_bond: number
  ply_count: number
  positions_text: string
}

export type SpecEditorAdhesiveRow = {
  id: string
  adhesive_id: string
  label: string
  ratio_percent: number
  base_percent: number
}

export type SpecEditorNotch = {
  notch_required: boolean
  top_paper_required: boolean
  notch_type: string
  notch_position: string
  notch_distance_mm: string
  notch_depth_mm: string
  notching_holder: string
  notching_blade: string
  groove: string
  punch: string
  tochha: string
  tochha_type: string
  wider_tool: string
  height_gauge_go: string
  height_gauge_no_go: string
  die: string
  tube_direction: string
}

export type SpecEditorPacking = {
  bundle_type: string
  bundle_code: string
  packing_ply: string
  qty_per_box: string
  packing_pcs: string
  box_code: string
  box_size: string
  plastic_required: boolean
  plastic_sku: string
  plastic_per_box: string
  fadda_sku: string
  fadda_per_box: string
  bopp_required: boolean
  special_instructions: string
}

export type SpecEditorState = {
  customerId: string
  customerName: string
  tubeSizeId: string
  mandrelId: string
  tubeLengthMm: number
  clientIdMm: number
  clientOdMm: number
  targetTubeWeight: number
  requiredCs: number
  shrinkPercent: number
  parchmentColor: string
  candidatePaperIds: string[]
  recipeRows: SpecEditorRecipeRow[]
  adhesives: SpecEditorAdhesiveRow[]
  notch: SpecEditorNotch
  packing: SpecEditorPacking
}

export type Suggestion = {
  id: string
  label: string
  rationale: string
  rows: SpecEditorRecipeRow[]
  predicted_paper_weight_g: number
  predicted_dry_weight_g: number
  delta_dry_g: number
}

export type BambooPlan = {
  selected_bamboo_length_mm: number
  usable_length_mm: number
  tubes_per_bamboo: number
  trim_waste_mm: number
}

export type PreviewMetrics = {
  wall_thickness_mm: number
  manufacturing_od_mm: number
  paper_weight_g: number
  adhesive_weight_g: number
  parchment_weight_g: number
  wet_weight_g: number
  bamboo_plan: BambooPlan | null
}

export function createLocalId(prefix = "row") {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`
}

export function estimateThicknessMm(gsm: number) {
  const numericGsm = Math.max(Number(gsm) || 0, 0)
  if (!numericGsm) return 0
  return Number(Math.max(0.18, 0.22 + (numericGsm - 250) * 0.00055).toFixed(3))
}

export function normalizePaper(paper: any) {
  const gsm = Number(paper?.gsm || 0)
  const strengthValue = Number(paper?.bf ?? paper?.strength_value ?? 0)
  const strengthType = String(paper?.strength_type || "BF").toUpperCase()
  const bf = Number.isFinite(strengthValue) ? strengthValue : 0
  const category = String(paper?.category || "KRAFT")
  const variety = String(paper?.variety || paper?.name || `${category} PAPER`)
  const code =
    String(paper?.code || "").trim() ||
    `${category}-${gsm || "NA"}-${bf || "NA"}${strengthType}`

  return {
    ...paper,
    id: String(paper?.id || ""),
    gsm,
    bf,
    strength_type: strengthType,
    category,
    variety,
    code,
    thickness_mm: Number(paper?.thickness_mm ?? estimateThicknessMm(gsm)),
    ply_bond: Number(paper?.ply_bond || 0),
    label: `${gsm} GSM ${category} · ${bf}${strengthType}`,
  }
}

export function paperWeightPerPlyG(gsm: number, tubeOdMm: number, tubeIdMm: number, tubeLengthMm: number) {
  const effectiveDiameterM = Math.max(((tubeIdMm + tubeOdMm) / 2) / 1000, 0.001)
  const tubeLengthM = Math.max(tubeLengthMm / 1000, 0.001)
  return gsm * Math.PI * effectiveDiameterM * tubeLengthM
}

function buildStrictComboLayers(
  paperMap: Record<number, any>,
  tubeLengthMm: number,
  tubeOdMm: number,
  tubeIdMm: number,
  targetWeightG: number,
  mandatoryPlyMinimums: Record<number, number>,
  preferredMinGsm: number,
) {
  const normalizedMinimums = Object.fromEntries(
    Object.entries(mandatoryPlyMinimums).map(([gsm, count]) => [Number(gsm), Number(count)]),
  )

  for (const gsmValue of Object.keys(normalizedMinimums).map(Number)) {
    if (!paperMap[gsmValue]) return null
  }

  const dryMultiplier = 1 + DEFAULT_ADHESIVE_PERCENT / 100 + DEFAULT_PARCHMENT_PERCENT / 100
  let baseWeightG = 0
  const baseLayers: number[] = []

  for (const [gsmValue, minimumCount] of Object.entries(normalizedMinimums)
    .map(([gsm, count]) => [Number(gsm), Number(count)] as const)
    .sort((left, right) => left[0] - right[0])) {
    baseLayers.push(...Array.from({ length: minimumCount }, () => gsmValue))
    baseWeightG += paperWeightPerPlyG(gsmValue, tubeOdMm, tubeIdMm, tubeLengthMm) * minimumCount
  }

  let candidateGsms = Object.keys(paperMap)
    .map(Number)
    .filter((gsmValue) => gsmValue >= preferredMinGsm)
    .sort((left, right) => left - right)

  if (candidateGsms.length === 0) {
    candidateGsms = Object.keys(paperMap)
      .map(Number)
      .filter((gsmValue) => !normalizedMinimums[gsmValue])
      .sort((left, right) => left - right)
  }

  if (candidateGsms.length === 0) {
    return null
  }

  const perPlyWeight = Object.fromEntries(
    candidateGsms.map((gsmValue) => [
      gsmValue,
      paperWeightPerPlyG(gsmValue, tubeOdMm, tubeIdMm, tubeLengthMm),
    ]),
  ) as Record<number, number>

  const maxAllowedDelta = Math.max(3, targetWeightG * 0.03)
  let bestLayers: number[] | null = null
  let bestScore: [number, number, number, number, number] | null = null

  for (const primaryGsm of candidateGsms) {
    for (const secondaryGsm of candidateGsms) {
      const remainingCapacity = Math.max(0, 36 - baseLayers.length)
      for (let primaryCount = 0; primaryCount <= remainingCapacity; primaryCount += 1) {
        for (let secondaryCount = 0; secondaryCount <= remainingCapacity - primaryCount; secondaryCount += 1) {
          if (primaryCount === 0 && secondaryCount === 0) continue

          const totalLayers = baseLayers.length + primaryCount + secondaryCount
          const predictedPaperWeightG =
            baseWeightG +
            perPlyWeight[primaryGsm] * primaryCount +
            perPlyWeight[secondaryGsm] * secondaryCount
          const predictedDryWeightG = predictedPaperWeightG * dryMultiplier
          const deltaDry = Math.abs(predictedDryWeightG - targetWeightG)

          const score: [number, number, number, number, number] = [
            deltaDry,
            primaryGsm >= preferredMinGsm && secondaryGsm >= preferredMinGsm ? 0 : 1,
            -(primaryCount + secondaryCount),
            totalLayers,
            Math.abs(primaryGsm - secondaryGsm),
          ]

          if (!bestScore || score < bestScore) {
            bestScore = score
            bestLayers = [
              ...baseLayers,
              ...Array.from({ length: primaryCount }, () => primaryGsm),
              ...Array.from({ length: secondaryCount }, () => secondaryGsm),
            ].sort((left, right) => left - right)
          }
        }
      }
    }
  }

  if (!bestLayers || !bestScore || bestScore[0] > maxAllowedDelta) {
    return null
  }

  return bestLayers
}

function canonicalRowFromPaper(paper: any, plyCount: number, rowIndex: number): SpecEditorRecipeRow {
  return {
    id: createLocalId("recipe"),
    paper_id: String(paper?.id || ""),
    code: String(paper?.code || ""),
    variety: String(paper?.variety || ""),
    category: String(paper?.category || ""),
    gsm: Number(paper?.gsm || 0),
    bf_per_ply: Number(paper?.bf || paper?.strength_value || 0),
    thickness_per_ply: Number(paper?.thickness_mm ?? estimateThicknessMm(Number(paper?.gsm || 0))),
    ply_bond: Number(paper?.ply_bond || 0),
    ply_count: plyCount,
    positions_text: rowIndex === 0 ? "Inner" : `Layer ${rowIndex + 1}`,
  }
}

function buildSuggestionRowsFromLayers(layers: number[], paperMap: Record<number, any>) {
  const counts = new Map<number, number>()
  for (const gsm of layers) {
    counts.set(gsm, (counts.get(gsm) || 0) + 1)
  }

  return Array.from(counts.entries()).map(([gsmValue, count], index) =>
    canonicalRowFromPaper(paperMap[gsmValue], count, index),
  )
}

export function buildBestMixSuggestions(
  papers: any[],
  params: {
    tubeLengthMm: number
    tubeOdMm: number
    tubeIdMm: number
    targetWeightG: number
  },
) {
  const normalizedPapers = papers.map(normalizePaper)
  const paperMap = Object.fromEntries(
    normalizedPapers.map((paper) => [Number(paper.gsm), paper]),
  ) as Record<number, any>

  const recipes = [
    {
      id: "strict-combo",
      label: "Workbook Combo",
      rationale: "2 x 250gsm + 1 x 300gsm + best 350+ remainder",
      minimums: STRICT_COMBO_MINIMUMS,
      preferredMinGsm: STRICT_COMBO_PREFERRED_MIN_GSM,
    },
    {
      id: "balanced-combo",
      label: "Balanced Mix",
      rationale: "Keeps 250 and 300gsm in the stack with a lighter high-GSM tail.",
      minimums: { 250: 1, 300: 1 },
      preferredMinGsm: 350,
    },
    {
      id: "strength-combo",
      label: "Strength First",
      rationale: "Biases toward higher GSM plies after the first structural layers.",
      minimums: { 300: 2 },
      preferredMinGsm: 350,
    },
  ]

  const dryMultiplier = 1 + DEFAULT_ADHESIVE_PERCENT / 100 + DEFAULT_PARCHMENT_PERCENT / 100
  const suggestions: Suggestion[] = []
  const seen = new Set<string>()

  for (const recipe of recipes) {
    const layers = buildStrictComboLayers(
      paperMap,
      params.tubeLengthMm,
      params.tubeOdMm,
      params.tubeIdMm,
      params.targetWeightG,
      recipe.minimums,
      recipe.preferredMinGsm,
    )
    if (!layers) continue

    const signature = layers.join("-")
    if (seen.has(signature)) continue
    seen.add(signature)

    const rows = buildSuggestionRowsFromLayers(layers, paperMap)
    const predictedPaperWeight = layers.reduce(
      (total, gsmValue) =>
        total + paperWeightPerPlyG(gsmValue, params.tubeOdMm, params.tubeIdMm, params.tubeLengthMm),
      0,
    )
    const predictedDryWeight = predictedPaperWeight * dryMultiplier
    suggestions.push({
      id: recipe.id,
      label: recipe.label,
      rationale: recipe.rationale,
      rows,
      predicted_paper_weight_g: Number(predictedPaperWeight.toFixed(2)),
      predicted_dry_weight_g: Number(predictedDryWeight.toFixed(2)),
      delta_dry_g: Number((predictedDryWeight - params.targetWeightG).toFixed(2)),
    })
  }

  return suggestions
}

export function buildBambooPlan(tubeLengthMm: number) {
  if (!tubeLengthMm) return null
  let bestPlan: BambooPlan | null = null

  for (let bambooLength = BAMBOO_MIN_LENGTH_MM; bambooLength <= BAMBOO_MAX_LENGTH_MM; bambooLength += BAMBOO_INCREMENT_MM) {
    const usableLength = bambooLength - BAMBOO_CUT_LOSS_MM
    const tubesPerBamboo = Math.floor(usableLength / tubeLengthMm)
    if (tubesPerBamboo <= 0) continue
    const trimWaste = usableLength - tubesPerBamboo * tubeLengthMm
    const candidate: BambooPlan = {
      selected_bamboo_length_mm: bambooLength,
      usable_length_mm: usableLength,
      tubes_per_bamboo: tubesPerBamboo,
      trim_waste_mm: Number(trimWaste.toFixed(1)),
    }

    if (
      !bestPlan ||
      candidate.tubes_per_bamboo > bestPlan.tubes_per_bamboo ||
      (candidate.tubes_per_bamboo === bestPlan.tubes_per_bamboo &&
        candidate.trim_waste_mm < bestPlan.trim_waste_mm) ||
      (candidate.tubes_per_bamboo === bestPlan.tubes_per_bamboo &&
        candidate.trim_waste_mm === bestPlan.trim_waste_mm &&
        candidate.selected_bamboo_length_mm < bestPlan.selected_bamboo_length_mm)
    ) {
      bestPlan = candidate
    }
  }

  return bestPlan
}

export function computePreviewMetrics(state: SpecEditorState, mandrel: any | null): PreviewMetrics {
  const paperWeightG = state.recipeRows.reduce(
    (total, row) => total + paperWeightPerPlyG(row.gsm, state.clientOdMm, state.clientIdMm, state.tubeLengthMm) * row.ply_count,
    0,
  )
  const adhesiveWeightG = state.targetTubeWeight * (DEFAULT_ADHESIVE_PERCENT / 100)
  const parchmentWeightG = state.targetTubeWeight * (DEFAULT_PARCHMENT_PERCENT / 100)
  const wallThicknessMm = state.recipeRows.reduce(
    (total, row) => total + Number(row.thickness_per_ply || 0) * Number(row.ply_count || 0),
    0,
  )
  const manufacturingBaseId = Number(mandrel?.outer_diameter_mm || state.clientIdMm || 0)
  const manufacturingOdMm = Number((manufacturingBaseId + wallThicknessMm * 2).toFixed(2))
  const wetWeightG = Number((state.targetTubeWeight / Math.max(1 - state.shrinkPercent / 100, 0.01)).toFixed(2))

  return {
    wall_thickness_mm: Number(wallThicknessMm.toFixed(3)),
    manufacturing_od_mm: manufacturingOdMm,
    paper_weight_g: Number(paperWeightG.toFixed(2)),
    adhesive_weight_g: Number(adhesiveWeightG.toFixed(2)),
    parchment_weight_g: Number(parchmentWeightG.toFixed(2)),
    wet_weight_g: wetWeightG,
    bamboo_plan: buildBambooPlan(state.tubeLengthMm),
  }
}

export function createDefaultAdhesiveRows(adhesives: any[] = []) {
  const normalized = adhesives.map((adhesive) => ({
    ...adhesive,
    id: String(adhesive?.id || ""),
    name: String(adhesive?.name || adhesive?.internal_code || ""),
    internal_code: String(adhesive?.internal_code || ""),
  }))

  const byToken = (token: string) =>
    normalized.find((adhesive) =>
      `${adhesive.name} ${adhesive.internal_code}`.toUpperCase().includes(token.toUpperCase()),
    )

  const first = byToken("20100") || normalized[0]
  const second = byToken("30100") || normalized[1] || normalized[0]

  return [
    {
      id: createLocalId("adh"),
      adhesive_id: String(first?.id || ""),
      label: String(first?.name || "TL-4 (20100)"),
      ratio_percent: 20,
      base_percent: DEFAULT_ADHESIVE_PERCENT,
    },
    {
      id: createLocalId("adh"),
      adhesive_id: String(second?.id || ""),
      label: String(second?.name || "Vinsol (30100)"),
      ratio_percent: 80,
      base_percent: DEFAULT_ADHESIVE_PERCENT,
    },
  ]
}

export function defaultNotchState(): SpecEditorNotch {
  return {
    notch_required: false,
    top_paper_required: false,
    notch_type: "Single",
    notch_position: "Top",
    notch_distance_mm: "",
    notch_depth_mm: "",
    notching_holder: "",
    notching_blade: "",
    groove: "",
    punch: "",
    tochha: "",
    tochha_type: "",
    wider_tool: "",
    height_gauge_go: "",
    height_gauge_no_go: "",
    die: "",
    tube_direction: "Standard",
  }
}

export function defaultPackingState(): SpecEditorPacking {
  return {
    bundle_type: "",
    bundle_code: "",
    packing_ply: "",
    qty_per_box: "",
    packing_pcs: "",
    box_code: "",
    box_size: "",
    plastic_required: false,
    plastic_sku: "",
    plastic_per_box: "",
    fadda_sku: "",
    fadda_per_box: "",
    bopp_required: false,
    special_instructions: "",
  }
}

export function createEmptyState(adhesives: any[] = []): SpecEditorState {
  return {
    customerId: "",
    customerName: "",
    tubeSizeId: "",
    mandrelId: "",
    tubeLengthMm: 150,
    clientIdMm: 110,
    clientOdMm: 122,
    targetTubeWeight: 250,
    requiredCs: 400,
    shrinkPercent: DEFAULT_DRYING_LOSS_PERCENT,
    parchmentColor: "",
    candidatePaperIds: [],
    recipeRows: [],
    adhesives: createDefaultAdhesiveRows(adhesives),
    notch: defaultNotchState(),
    packing: defaultPackingState(),
  }
}

function parseJsonText(value: any, fallback: any) {
  if (typeof value !== "string") return fallback
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

export function parseSpecState(spec: any, recipe: any, adhesives: any[] = []): SpecEditorState {
  const base = createEmptyState(adhesives)
  if (!spec) return base

  const profile = spec.profile || {}
  const recipeProfile = profile.recipe || {}
  const recipeRows = Array.isArray(recipeProfile.recipe_rows) ? recipeProfile.recipe_rows : []
  const profileAdhesives = Array.isArray(recipeProfile.adhesive_components)
    ? recipeProfile.adhesive_components
    : parseJsonText(spec.adhesive_components_json, [])
  const candidatePapers = Array.isArray(recipeProfile.candidate_papers) ? recipeProfile.candidate_papers : []
  const latestRecipeLayers = Array.isArray(recipe?.layers) ? recipe.layers : []

  const hydratedRows: SpecEditorRecipeRow[] =
    recipeRows.length > 0
      ? recipeRows.map((row: any, index: number) => ({
          id: createLocalId("recipe"),
          paper_id: String(row?.paper_id || ""),
          code: String(row?.code || ""),
          variety: String(row?.variety || ""),
          category: String(row?.category || ""),
          gsm: Number(row?.gsm || 0),
          bf_per_ply: Number(row?.bf_per_ply ?? row?.bfPerPly ?? 0),
          thickness_per_ply: Number(row?.thickness_per_ply ?? row?.thicknessPerPly ?? estimateThicknessMm(Number(row?.gsm || 0))),
          ply_bond: Number(row?.ply_bond ?? row?.plyBond ?? 0),
          ply_count: Number(row?.ply_count ?? row?.plyCount ?? 1),
          positions_text: String(row?.positions_text ?? row?.positionsText ?? `Layer ${index + 1}`),
        }))
      : latestRecipeLayers.map((layer: any, index: number) => ({
          id: createLocalId("recipe"),
          paper_id: String(layer?.paper_id || ""),
          code: "",
          variety: "",
          category: "",
          gsm: Number(layer?.gsm_snapshot || 0),
          bf_per_ply: Number(layer?.bf_snapshot || 0),
          thickness_per_ply: estimateThicknessMm(Number(layer?.gsm_snapshot || 0)),
          ply_bond: 0,
          ply_count: 1,
          positions_text: `Layer ${index + 1}`,
        }))

  const adhesiveRows: SpecEditorAdhesiveRow[] =
    profileAdhesives.length > 0
      ? profileAdhesives.map((component: any) => ({
          id: createLocalId("adh"),
          adhesive_id: String(component?.adhesive_id || ""),
          label: String(component?.name || component?.label || component?.adhesive_id || "Adhesive"),
          ratio_percent: Number(component?.ratio_percent || 0),
          base_percent: Number(component?.base_percent || DEFAULT_ADHESIVE_PERCENT),
        }))
      : [
          {
            id: createLocalId("adh"),
            adhesive_id: "",
            label: "TL-4 (20100)",
            ratio_percent: Number(spec?.adhesive_20100_percent || 20),
            base_percent: DEFAULT_ADHESIVE_PERCENT,
          },
          {
            id: createLocalId("adh"),
            adhesive_id: "",
            label: "Vinsol (30100)",
            ratio_percent: Number(spec?.adhesive_30100_percent || 80),
            base_percent: DEFAULT_ADHESIVE_PERCENT,
          },
        ]

  return {
    customerId: String(spec?.customer_id || ""),
    customerName: String(spec?.customer_name_snapshot || spec?.customer_name || ""),
    tubeSizeId: String(spec?.tube_size_id || ""),
    mandrelId: String(spec?.mandrel_id || ""),
    tubeLengthMm: Number(spec?.length_max_mm || spec?.length_min_mm || base.tubeLengthMm),
    clientIdMm: Number(spec?.id_max_mm || spec?.id_min_mm || base.clientIdMm),
    clientOdMm: Number(spec?.od_max_mm || spec?.od_min_mm || base.clientOdMm),
    targetTubeWeight: Number(spec?.target_tube_weight || base.targetTubeWeight),
    requiredCs: Number(spec?.required_cs || base.requiredCs),
    shrinkPercent: Number(spec?.shrink_percent || base.shrinkPercent),
    parchmentColor: String(spec?.parchment_color || ""),
    candidatePaperIds: candidatePapers
      .map((paper: any) => String(paper?.id || paper?.paper_id || ""))
      .filter(Boolean),
    recipeRows: hydratedRows,
    adhesives: adhesiveRows,
    notch: {
      ...defaultNotchState(),
      ...((profile?.notch_tooling || {}).diagram || {}),
    },
    packing: {
      ...defaultPackingState(),
      ...((profile?.packing_rules || {}).packing_target || {}),
      ...(profile?.packing || {}),
    },
  }
}

export function buildProfilePayload(
  state: SpecEditorState,
  selectedCandidates: any[],
  preview: PreviewMetrics,
) {
  const recipeRows = state.recipeRows.map((row) => ({
    paper_id: row.paper_id,
    code: row.code,
    variety: row.variety,
    category: row.category,
    gsm: row.gsm,
    bf_per_ply: row.bf_per_ply,
    thickness_per_ply: row.thickness_per_ply,
    ply_bond: row.ply_bond,
    ply_count: row.ply_count,
    positions_text: row.positions_text,
  }))

  const adhesiveComponents = state.adhesives.map((component) => ({
    adhesive_id: component.adhesive_id,
    name: component.label,
    ratio_percent: Number(component.ratio_percent || 0),
    base_percent: Number(component.base_percent || DEFAULT_ADHESIVE_PERCENT),
  }))

  return {
    recipe: {
      candidate_papers: selectedCandidates.map((paper) => ({
        id: String(paper?.id || ""),
        code: String(paper?.code || ""),
        variety: String(paper?.variety || paper?.name || ""),
        category: String(paper?.category || ""),
        gsm: Number(paper?.gsm || 0),
        bf: Number(paper?.bf || paper?.strength_value || 0),
        thickness_mm: Number(paper?.thickness_mm ?? estimateThicknessMm(Number(paper?.gsm || 0))),
      })),
      adhesive_components: adhesiveComponents,
      recipe_rows: recipeRows,
    },
    notch_tooling: {
      diagram: {
        ...state.notch,
      },
    },
    packing: {
      ...state.packing,
    },
    packing_rules: {
      packing_target: {
        ...state.packing,
      },
    },
    manufacturing: {
      client_id_mm: state.clientIdMm,
      client_od_mm: state.clientOdMm,
      tube_length_mm: state.tubeLengthMm,
      target_tube_weight_g: state.targetTubeWeight,
      required_cs_n: state.requiredCs,
      shrink_percent: state.shrinkPercent,
      bamboo_plan: preview.bamboo_plan,
      wall_thickness_mm: preview.wall_thickness_mm,
      manufacturing_od_mm: preview.manufacturing_od_mm,
      wet_weight_g: preview.wet_weight_g,
    },
  }
}

export function buildSpecPayload(
  state: SpecEditorState,
  selectedCandidates: any[],
  preview: PreviewMetrics,
) {
  return {
    customer_name: state.customerName,
    customer_id: state.customerId || null,
    customer_name_snapshot: state.customerName,
    tube_size_id: state.tubeSizeId,
    mandrel_id: state.mandrelId,
    required_cs: Number(state.requiredCs || 0),
    target_tube_weight: Number(state.targetTubeWeight || 0),
    id_min_mm: Number(state.clientIdMm || 0),
    id_max_mm: Number(state.clientIdMm || 0),
    od_min_mm: Number(state.clientOdMm || 0),
    od_max_mm: Number(state.clientOdMm || 0),
    length_min_mm: Number(state.tubeLengthMm || 0),
    length_max_mm: Number(state.tubeLengthMm || 0),
    weight_min_g: Number(state.targetTubeWeight || 0),
    weight_max_g: Number(state.targetTubeWeight || 0),
    cs_min_n: Number(state.requiredCs || 0),
    cs_max_n: Number(state.requiredCs || 0),
    moisture_min_pct: 6,
    moisture_max_pct: 10,
    parchment_percent: DEFAULT_PARCHMENT_PERCENT,
    parchment_color: state.parchmentColor || null,
    shrink_percent: Number(state.shrinkPercent || DEFAULT_DRYING_LOSS_PERCENT),
    adhesive_20100_percent: Number(state.adhesives[0]?.ratio_percent || 0),
    adhesive_30100_percent: Number(state.adhesives[1]?.ratio_percent || 0),
    profile: buildProfilePayload(state, selectedCandidates, preview),
  }
}

export function buildRecipeLayers(state: SpecEditorState) {
  let plyNo = 1
  return state.recipeRows.flatMap((row) =>
    Array.from({ length: Math.max(1, Number(row.ply_count || 1)) }, () => {
      const payload = {
        ply_no: plyNo,
        paper_id: row.paper_id,
        gsm_snapshot: Number(row.gsm || 0),
        bf_snapshot: Number(row.bf_per_ply || 0),
      }
      plyNo += 1
      return payload
    }),
  )
}

export function resolveSpecTitle(spec: any) {
  const customer = String(spec?.customer_name_snapshot || spec?.customer_name || "").trim()
  const reference = String(spec?.spec_reference || "").trim()
  if (reference) return reference
  if (customer) return customer
  return `Specification ${String(spec?.id || "").slice(0, 8).toUpperCase()}`
}
