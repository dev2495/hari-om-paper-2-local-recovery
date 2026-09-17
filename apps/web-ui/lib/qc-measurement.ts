export type QcStageKey = "WINDER" | "OVEN" | "PROCESS"

export type QcParameterDef = {
  code: string
  label: string
  unit: string
  pairGroup?: string
  conditional?: string
}

export type QcParameterRule = {
  code: string
  label: string
  unit: string
  method?: string | null
  specimen?: string | null
  sampling?: string | null
  min?: number | null
  max?: number | null
  inclusive_min?: boolean
  inclusive_max?: boolean
  required?: boolean
  applicable?: boolean
  pair_group?: string | null
  conditional?: string | null
}

export const QC_STAGE_PARAMETERS: Record<QcStageKey, QcParameterDef[]> = {
  WINDER: [
    { code: "id", label: "I.D.", unit: "mm" },
    { code: "od", label: "O.D.", unit: "mm" },
    { code: "height", label: "Height", unit: "mm" },
    { code: "weight", label: "Weight", unit: "g" },
    { code: "cs", label: "C.S.", unit: "N" },
  ],
  OVEN: [
    { code: "pre_weight", label: "Pre-weight", unit: "g", pairGroup: "oven_sample" },
    { code: "post_weight", label: "Post-weight", unit: "g", pairGroup: "oven_sample" },
    { code: "pre_moisture", label: "Pre-moisture", unit: "%", pairGroup: "oven_sample" },
    { code: "post_moisture", label: "Post-moisture", unit: "%", pairGroup: "oven_sample" },
  ],
  PROCESS: [
    { code: "height", label: "Height", unit: "mm" },
    { code: "weight", label: "Weight", unit: "g" },
    { code: "cs", label: "C.S.", unit: "N" },
    { code: "notch_distance", label: "Notch distance", unit: "mm", conditional: "notching" },
    { code: "notch_depth", label: "Notch depth", unit: "mm", conditional: "notching" },
    { code: "moisture", label: "Moisture", unit: "%" },
  ],
}

export function emptyQcProfile(notchingApplicable = false) {
  const stages: Record<string, { parameters: QcParameterRule[] }> = {}
  for (const [stage, defs] of Object.entries(QC_STAGE_PARAMETERS)) {
    stages[stage] = {
      parameters: defs.map((item) => ({
        code: item.code,
        label: item.label,
        unit: item.unit,
        method: "",
        specimen: "",
        sampling: "",
        min: null,
        max: null,
        inclusive_min: true,
        inclusive_max: true,
        required: true,
        applicable: item.conditional === "notching" ? notchingApplicable : true,
        pair_group: item.pairGroup || null,
        conditional: item.conditional || null,
      })),
    }
  }
  return {
    status: "draft",
    revision: 1,
    notching_applicable: notchingApplicable,
    stages,
  }
}

export function qcSetupStatus(profile: any): "missing" | "draft" | "complete" | "approved" | "pending_review" {
  if (!profile || typeof profile !== "object") return "missing"
  const explicit = String(profile.status || "").toLowerCase()
  if (explicit === "approved") return "approved"
  if (explicit === "pending_review") return "pending_review"
  const stages = profile.stages || {}
  let anyBounds = false
  let complete = true
  for (const stage of Object.keys(QC_STAGE_PARAMETERS)) {
    const parameters = Array.isArray(stages[stage]?.parameters) ? stages[stage].parameters : []
    if (!parameters.length) {
      complete = false
      continue
    }
    for (const row of parameters) {
      if (row.applicable === false) continue
      if (row.min != null || row.max != null) anyBounds = true
      if (row.required !== false && row.min == null && row.max == null) complete = false
    }
  }
  if (!anyBounds) return "missing"
  if (complete) return explicit === "draft" ? "draft" : "complete"
  return "draft"
}

export function qcActionLabel(status: ReturnType<typeof qcSetupStatus>) {
  if (status === "missing") return "Add QC"
  if (status === "draft") return "Complete QC"
  if (status === "pending_review") return "View QC"
  return "View QC"
}

export function formatAllowedRange(rule: Pick<QcParameterRule, "min" | "max" | "unit" | "applicable"> | null | undefined) {
  if (!rule || rule.applicable === false) return "Not applicable"
  if (rule.min == null && rule.max == null) return "Allowed: not configured"
  const unit = rule.unit ? ` ${rule.unit}` : ""
  if (rule.min != null && rule.max != null) return `Allowed: ${rule.min}–${rule.max}${unit}`
  if (rule.min != null) return `Allowed: ≥ ${rule.min}${unit}`
  return `Allowed: ≤ ${rule.max}${unit}`
}

export function frozenStageRules(profile: any, stage: QcStageKey): QcParameterRule[] {
  const rows = profile?.stages?.[stage]?.parameters
  if (!Array.isArray(rows) || !rows.length) return QC_STAGE_PARAMETERS[stage].map((item) => ({
    code: item.code,
    label: item.label,
    unit: item.unit,
    min: null,
    max: null,
    applicable: item.conditional !== "notching",
    required: true,
    pair_group: item.pairGroup,
    conditional: item.conditional,
  }))
  return rows
}

function firstFilled(source: Record<string, any> | null | undefined, keys: string[]) {
  if (!source) return ""
  for (const key of keys) {
    const value = source[key]
    if (value !== null && value !== undefined && String(value).trim() !== "") return value
  }
  return ""
}

export function collectStageQualityChecks(stage: QcStageKey, entry: any) {
  const readings: Record<string, any> = { ...(entry?.qc_readings || {}) }
  const reasons = entry?.qc_reasons && typeof entry.qc_reasons === "object" ? entry.qc_reasons : {}
  const sampleId = String(entry?.qc_sample_id || readings.sample_id || "").trim()
  if (stage === "WINDER") {
    const first = Array.isArray(entry?.dimension_readings) ? entry.dimension_readings[0] || {} : {}
    for (const code of ["id", "od", "height", "weight", "cs"]) {
      if (readings[code] == null || readings[code] === "") {
        readings[code] = firstFilled(first, code === "height" ? ["height", "length"] : [code])
      }
    }
  }
  if (stage === "OVEN") {
    const aliases: Record<string, string[]> = {
      pre_weight: ["pre_weight", "pre_oven_weight_kg"],
      post_weight: ["post_weight", "post_oven_weight_kg"],
      pre_moisture: ["pre_moisture", "moisture_before"],
      post_moisture: ["post_moisture", "moisture_after"],
    }
    for (const [code, keys] of Object.entries(aliases)) {
      if (readings[code] == null || readings[code] === "") {
        readings[code] = firstFilled(entry, keys)
      }
    }
  }
  if (stage === "PROCESS") {
    const measurements = entry?.final_measurements || {}
    for (const code of ["height", "weight", "cs", "notch_distance", "notch_depth", "moisture"]) {
      if (readings[code] == null || readings[code] === "") {
        readings[code] = firstFilled(measurements, code === "height" ? ["height", "length"] : [code])
      }
    }
  }
  const numeric: Record<string, any> = {}
  for (const [key, value] of Object.entries(readings)) {
    if (value === "" || value == null) continue
    const number = Number(value)
    numeric[key] = Number.isFinite(number) ? number : value
  }
  const hasReadings = Object.keys(numeric).length > 0
  return {
    readings: numeric,
    reasons,
    sample_id: sampleId || undefined,
    hasReadings,
  }
}

export function emptyIncomingProfile() {
  return {
    setup_status: "draft",
    status: "draft",
    revision: 1,
    inspection_required: true,
    parameters: [] as QcParameterRule[],
  }
}
