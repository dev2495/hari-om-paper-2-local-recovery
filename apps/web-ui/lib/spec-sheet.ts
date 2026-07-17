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

export const TOOL_CATEGORY_LABELS: Record<string, string> = {
  NOTCH: "Notch",
  BLADE: "Blade",
  HOLDER: "Holder",
  V_FLAT: "V + Flat",
  PUNCH: "Punch",
}

export const NOTCH_TOOL_FIELD_CATEGORY_MAP: Record<string, string[]> = {
  notch_type: ["NOTCH"],
  notching_blade: ["BLADE"],
  notching_holder: ["HOLDER"],
  v_flat: ["V_FLAT"],
  punch: ["PUNCH"],
}

export const NOTCH_TOOL_FIELD_KEYS = Object.keys(NOTCH_TOOL_FIELD_CATEGORY_MAP)
export const NOTCH_DIAGRAM_FIELD_KEYS = ["notch_distance_mm", "notch_depth_mm"] as const
export const NOTCH_DIRECTION_OPTIONS = ["Clockwise", "Anticlockwise"] as const
export const SPEC_NOTCH_FIELD_KEYS = [
  "notch_type",
  "notching_blade",
  "notching_holder",
  "v_flat",
  "punch",
  "notch_direction",
  "notch_distance_mm",
  "notch_depth_mm",
] as const

export type ToolMasterPointField = {
  key: string
  label: string
  input: "text" | "select"
  options?: readonly string[]
  placeholder?: string
  required?: boolean
}

export const TOOL_MASTER_POINT_FIELDS: Record<string, ToolMasterPointField[]> = {
  NOTCH: [
    { key: "type", label: "Type", input: "select", required: true },
    { key: "thickness", label: "Thickness", input: "text", placeholder: "6 mm", required: true },
    { key: "design", label: "Design", input: "select", required: true },
    { key: "degree", label: "Degree", input: "select", required: true },
  ],
  BLADE: [
    { key: "type", label: "Type", input: "select", required: true },
    { key: "thickness", label: "Thickness", input: "text", placeholder: "0.9 mm", required: true },
    { key: "height", label: "Height", input: "text", placeholder: "Height" },
    { key: "length", label: "Length", input: "text", placeholder: "140/130/20", required: true },
  ],
  HOLDER: [
    { key: "thickness", label: "Thickness", input: "text", placeholder: "Thickness", required: true },
    { key: "height", label: "Height", input: "text", placeholder: "Height" },
    { key: "length", label: "Length", input: "text", placeholder: "Length", required: true },
  ],
  V_FLAT: [
    { key: "length", label: "Length", input: "text", placeholder: "70+30", required: true },
    { key: "thickness", label: "Thickness", input: "text", placeholder: "4.0", required: true },
  ],
  PUNCH: [
    { key: "punch", label: "Punch", input: "select", required: true },
  ],
}

export function sanitizeToolMasterPoints(category: string, points: Record<string, any> = {}) {
  const fields = TOOL_MASTER_POINT_FIELDS[String(category || "").trim().toUpperCase()] || []
  const cleaned: Record<string, string> = {}
  for (const field of fields) {
    const value = String(points[field.key] ?? "").trim()
    if (value) cleaned[field.key] = value
  }
  return cleaned
}

export function parseToolMasterSpecText(value: any) {
  if (!value || typeof value !== "string") return {}
  try {
    const parsed = JSON.parse(value)
    if (parsed && typeof parsed === "object" && parsed.points && typeof parsed.points === "object") {
      return Object.fromEntries(
        Object.entries(parsed.points as Record<string, any>)
          .map(([key, pointValue]) => [key, String(pointValue ?? "").trim()])
          .filter(([, pointValue]) => Boolean(pointValue)),
      )
    }
  } catch {
    return {}
  }
  return {}
}

export function serializeToolMasterPoints(category: string, points: Record<string, any>) {
  const cleaned = sanitizeToolMasterPoints(category, points)
  if (!Object.keys(cleaned).length) return undefined
  return JSON.stringify({ version: 1, points: cleaned })
}

export function formatToolMasterPoints(category: string, points: Record<string, any> = {}) {
  const normalizedCategory = String(category || "").trim().toUpperCase()
  const cleaned = sanitizeToolMasterPoints(normalizedCategory, points)
  if (!Object.keys(cleaned).length) return ""
  if (normalizedCategory === "NOTCH") {
    return [
      cleaned.type,
      cleaned.thickness,
      cleaned.design,
      cleaned.degree ? `${cleaned.degree} deg` : "",
    ]
      .filter(Boolean)
      .join(" - ")
  }
  if (normalizedCategory === "BLADE") {
    return [
      cleaned.type ? `${cleaned.type} Blade` : "",
      cleaned.thickness,
      cleaned.height ? `H ${cleaned.height}` : "",
      cleaned.length ? `L ${cleaned.length}` : "",
    ]
      .filter(Boolean)
      .join(" - ")
  }
  if (normalizedCategory === "HOLDER") {
    return [
      "Holder",
      cleaned.thickness,
      cleaned.height ? `H ${cleaned.height}` : "",
      cleaned.length ? `L ${cleaned.length}` : "",
    ]
      .filter(Boolean)
      .join(" - ")
  }
  if (normalizedCategory === "V_FLAT") {
    return ["V + Flat", cleaned.length, cleaned.thickness ? `${cleaned.thickness} thick` : ""]
      .filter(Boolean)
      .join(" - ")
  }
  if (normalizedCategory === "PUNCH") return cleaned.punch || ""
  return Object.values(cleaned).filter(Boolean).join(" - ")
}

export function formatToolMasterSpecText(category: string, specText?: string | null) {
  const points = parseToolMasterSpecText(specText)
  return formatToolMasterPoints(category, points) || String(specText || "").trim()
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
    notch_type?: string | null
    notch_distance_mm?: number | null
    notch_depth_mm?: number | null
    notching_holder?: string | null
    notching_blade?: string | null
    v_flat?: string | null
    punch?: string | null
    notch_direction?: string | null
    diagram?: Record<string, any>
    tooling_usage?: Array<Record<string, any>>
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
  parchment_allowed?: boolean
  adhesive_percent?: number
  moisture_loss_percent?: number
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
  bulk_snapshot?: number | null
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
  weightG: number
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
  bulkFactor?: number
  plyBond: number
  plyCount: number
  adhesiveLabel: string
  positionsText: string
}

export type AdhesiveComponent = {
  adhesive_id?: string
  name: string
  base_percent: number
  ratio_percent: number
  solid_content_percent?: number | null
}

export function isMasterOptionActive(row: any) {
  if (!row) return false
  const status = String(row.status ?? row.lifecycle_status ?? row.state ?? "ACTIVE").trim().toUpperCase()
  const blockedStatuses = new Set([
    "ARCHIVED",
    "DELETED",
    "DISCONTINUED",
    "INACTIVE",
    "MAINTENANCE",
    "OBSOLETE",
    "RETIRED",
    "SCRAP",
    "SCRAPPED",
  ])

  return !(
    row.active === false ||
    row.is_active === false ||
    row.enabled === false ||
    row.discontinued === true ||
    row.is_discontinued === true ||
    Boolean(row.deleted_at) ||
    Boolean(row.archived_at) ||
    blockedStatuses.has(status)
  )
}

function numericField(row: any, keys: string[]) {
  for (const key of keys) {
    const value = Number(row?.[key])
    if (Number.isFinite(value) && value > 0) return value
  }
  return 0
}

export function tubeInnerDiameterMm(tube: any) {
  return numericField(tube, ["inner_diameter_mm", "id_mm", "inside_diameter_mm", "inner_diameter"])
}

export function mandrelOuterDiameterMm(mandrel: any) {
  return numericField(mandrel, ["outer_diameter_mm", "od_mm", "diameter_mm", "size_mm"])
}

export function isTubeWithinMandrelBand(tube: any, mandrel: any, toleranceMm = 1) {
  if (!mandrel) return true
  const tubeId = tubeInnerDiameterMm(tube)
  const mandrelSize = mandrelOuterDiameterMm(mandrel)
  if (!tubeId || !mandrelSize) return false
  return Math.abs(tubeId - mandrelSize) <= toleranceMm
}

export function adhesiveRatioTotal(components: AdhesiveComponent[]) {
  return (components || []).reduce((sum, component) => sum + Number(component?.ratio_percent || 0), 0)
}

export function isAdhesiveRatioBalanced(components: AdhesiveComponent[], tolerance = 0.01) {
  return Math.abs(adhesiveRatioTotal(components) - 100) <= tolerance
}

export function applyPaperMasterToRecipeRow(row: GroupedRecipeRow, paper: any): GroupedRecipeRow {
  if (!paper) return row
  const labels = buildGroupedRowLabel(paper)
  const gsm = Number(paper?.gsm || 0)
  const bulkFactor = Number(paper?.bulk_factor ?? paper?.bulk ?? row.bulkFactor ?? 0)
  const masterThickness = Number(
    paper?.thickness_mm ??
      paper?.thickness ??
      (bulkFactor > 0 && gsm > 0 ? roundValue((gsm * bulkFactor) / 1000, 4) : 0),
  )

  return {
    ...row,
    paper_id: String(paper?.id || row.paper_id || ""),
    code: labels.code,
    variety: labels.variety,
    category: labels.category,
    gsm,
    bfPerPly: Number(paper?.bf ?? paper?.strength_value ?? paper?.bf_per_ply ?? 0),
    thicknessPerPly: masterThickness || Number(row.thicknessPerPly || 0),
    bulkFactor,
    plyBond: Number(paper?.ply_bond ?? paper?.plybond ?? paper?.ply_bond_value ?? 0),
  }
}

export function formatRecipeRowsTitle(
  rows: GroupedRecipeRow[],
  options?: { includeCounts?: boolean },
) {
  const includeCounts = options?.includeCounts ?? true
  const activeRows = (rows || []).filter((row) => {
    const plyCount = Math.max(1, Math.floor(Number(row?.plyCount || 0) || 0))
    const hasPaper = String(row?.paper_id || "").trim().length > 0 || String(row?.code || "").trim().length > 0
    return hasPaper && plyCount > 0
  })

  if (!activeRows.length) return ""

  const grouped = new Map<string, number>()
  for (const row of activeRows) {
    const code = String(row.code || row.variety || row.category || row.paper_id || "PAPER").trim()
    const plyCount = Math.max(1, Math.floor(Number(row.plyCount || 1)))
    grouped.set(code, (grouped.get(code) || 0) + plyCount)
  }

  return Array.from(grouped.entries())
    .map(([code, plyCount]) => (includeCounts ? `${code} × ${plyCount}` : code))
    .join(" · ")
}

export type ProcessGuidanceRow = {
  rh: string
  dryingPercent: number
  moistureBand: string
}

export const DEFAULT_MOISTURE_AVG = 9
export const DEFAULT_WET_DIVISOR = 0.91
export const DEFAULT_TOLERANCE_BANDS: ToleranceBands = {
  id: 0.5,
  od: 0.5,
  length: 2,
  weightG: 3,
  csPct: 7,
  moisture: 1,
}

export const DEFAULT_PROCESS_GUIDANCE: ProcessGuidanceRow[] = []

export const DEFAULT_SPEC_FIELD_DEFINITIONS: ScalarDynamicField[] = [
  { field_key: "glue_mode", label: "Glue Mode", field_type: "select", options: ["workbook", "direct_ratio"] },
  { field_key: "glue_base_percent", label: "Glue Base %", field_type: "number" },
  { field_key: "allowed_parchment_groups_json", label: "Allowed Parchment Groups JSON", field_type: "text" },
  { field_key: "adhesive_components_json", label: "Adhesive Components JSON", field_type: "text" },
  { field_key: "measured_finished_dry_g", label: "Measured Finished Dry Weight", field_type: "number" },
  { field_key: "drying_percent_override", label: "Drying Override %", field_type: "number" },
  { field_key: "fill_instructions_version", label: "Fill Instructions Version", field_type: "text" },
  { field_key: "notch_type", label: "Notch Tool", field_type: "select" },
  { field_key: "notching_blade", label: "Blade Tool", field_type: "select" },
  { field_key: "notching_holder", label: "Holder Tool", field_type: "select" },
  { field_key: "v_flat", label: "V + Flat Tool", field_type: "select" },
  { field_key: "punch", label: "Punch", field_type: "select" },
  { field_key: "notch_direction", label: "Direction", field_type: "select" },
  { field_key: "notch_distance_mm", label: "Notch Distance", field_type: "number" },
  { field_key: "notch_depth_mm", label: "Notch Depth", field_type: "number" },
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
  const weight_min_g = roundValue(Math.max(avg.weight - bands.weightG, 0), 2)
  const weight_max_g = roundValue(avg.weight + bands.weightG, 2)
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
        const adhesive_id = String(source.adhesive_id || source.id || "").trim() || undefined
        const rawSolids = source.solid_content_percent
        const solid_content_percent = rawSolids === null || rawSolids === undefined || rawSolids === ""
          ? null
          : Number(rawSolids)
        return {
          adhesive_id,
          name,
          base_percent,
          ratio_percent,
          solid_content_percent: Number.isFinite(solid_content_percent) ? solid_content_percent : null,
        }
      })
      .filter(Boolean) as AdhesiveComponent[]
    if (normalized.length > 0) return normalized.slice(0, 6)
  }
  return []
}

export function buildAdhesiveComponentsPayload(
  components: AdhesiveComponent[],
  fallback: { tl4?: number; vinsol?: number; basePercent?: number } = {},
) {
  const normalized = components
    .filter((item) => Number(item.base_percent) > 0 && Number(item.ratio_percent) > 0 && item.name.trim().length > 0)
    .slice(0, 6)

  if (normalized.length > 0) return normalized

  const basePercent = Number(fallback.basePercent ?? 15)
  const tl4 = Number(fallback.tl4 ?? 0)
  const vinsol = Number(fallback.vinsol ?? 0)
  const legacy: AdhesiveComponent[] = []
  if (tl4 > 0) legacy.push({ name: "TL4(Vinsol) / 20100", base_percent: basePercent, ratio_percent: tl4 })
  if (vinsol > 0) legacy.push({ name: "Alcosol / 30100", base_percent: basePercent, ratio_percent: vinsol })
  return legacy
}
