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
  const hasAssignedRows = Object.keys(QC_STAGE_PARAMETERS).some((stage) =>
    Array.isArray(stages[stage]?.parameters) && stages[stage].parameters.some((row: any) => row?.code),
  )
  if (explicit === "draft") return hasAssignedRows ? "draft" : "missing"
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
  if (complete) return "complete"
  return "draft"
}

export function qcMissingFieldLabels(profile: any): string[] {
  const stages = profile?.stages || {}
  const labels: string[] = []
  for (const [stage, defs] of Object.entries(QC_STAGE_PARAMETERS)) {
    const rows = Array.isArray(stages[stage]?.parameters) ? stages[stage].parameters : []
    const byCode = Object.fromEntries(rows.map((row: any) => [row.code, row]))
    for (const def of defs) {
      const row = byCode[def.code] || {}
      if (row.applicable === false) continue
      if (row.min == null && row.max == null) labels.push(def.label)
    }
  }
  return labels
}

export type QcActorRole = "author" | "approver" | "viewer"

export function qcActionLabel(
  status: ReturnType<typeof qcSetupStatus>,
  options?: { role?: QcActorRole; specRetired?: boolean },
) {
  const role = options?.role || "author"
  if (options?.specRetired) return "View quality parameters"
  if (status === "missing") return role === "viewer" ? "View quality parameters" : "Add quality parameters"
  if (status === "draft") return role === "viewer" ? "View quality parameters" : "Complete quality setup"
  if (status === "pending_review") return role === "approver" ? "Review quality parameters" : "View pending"
  if (status === "complete") return role === "approver" ? "Review quality parameters" : role === "viewer" ? "View pending" : "Complete quality setup"
  return "View quality parameters"
}

export function qcRowActions(args: {
  qcStatus: ReturnType<typeof qcSetupStatus>
  specId: string
  specStatus?: string | null
  active?: boolean | null
  canAuthor: boolean
  canApprove: boolean
}): Array<{ label: string; href: string; kind: string }> {
  const retired = args.active === false || String(args.specStatus || "").toLowerCase() === "obsolete"
  const viewHref = `/specifications/${args.specId}`
  if (retired) {
    return [{ label: "View quality parameters", href: viewHref, kind: "view" }]
  }
  if (args.qcStatus === "missing") {
    return args.canAuthor
      ? [{ label: "Add quality parameters", href: `/specifications/${args.specId}/edit?qc=add`, kind: "add" }]
      : [{ label: "View quality parameters", href: viewHref, kind: "view" }]
  }
  if (args.qcStatus === "draft") {
    return args.canAuthor
      ? [{ label: "Complete quality setup", href: `/specifications/${args.specId}/edit?qc=complete`, kind: "complete" }]
      : [{ label: "View quality parameters", href: viewHref, kind: "view" }]
  }
  if (args.qcStatus === "pending_review" || args.qcStatus === "complete") {
    if (args.canApprove) {
      return [{ label: "Review quality parameters", href: viewHref, kind: "review" }]
    }
    return [{ label: "View pending", href: viewHref, kind: "pending" }]
  }
  const actions = [{ label: "View quality parameters", href: viewHref, kind: "view" }]
  if (args.canAuthor) {
    actions.push({
      label: "Create QC revision",
      href: `/specifications/${args.specId}/edit?qc=revise`,
      kind: "revise",
    })
  }
  return actions
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

function parseNumericReading(value: any): { missing?: boolean; invalid?: boolean; value?: number; raw?: any } {
  if (value === null || value === undefined) return { missing: true }
  if (typeof value === "boolean") return { invalid: true, raw: value }
  if (typeof value === "string") {
    const trimmed = value.trim()
    if (trimmed === "") return { missing: true }
    if (!/^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(trimmed)) {
      return { invalid: true, raw: value }
    }
    const number = Number(trimmed)
    if (!Number.isFinite(number)) return { invalid: true, raw: value }
    return { value: number, raw: value }
  }
  const number = Number(value)
  if (!Number.isFinite(number)) return { invalid: true, raw: value }
  return { value: number, raw: value }
}

function sampleHasContent(row: Record<string, any> | null | undefined) {
  if (!row) return false
  return Object.entries(row).some(([key, value]) => {
    if (key === "sample_id") return false
    if (value === null || value === undefined) return false
    if (typeof value === "string" && value.trim() === "") return false
    return true
  })
}

export function collectStageQualityChecks(stage: QcStageKey, entry: any) {
  const reasons = entry?.qc_reasons && typeof entry.qc_reasons === "object" ? entry.qc_reasons : {}
  const unitConflicts: Array<{ field: string; source: string; source_unit: string; target_unit: string }> = []
  const samples: Array<{ sample_id: string; readings: Record<string, any>; invalid?: Record<string, any> }> = []
  const numeric: Record<string, any> = {}
  const invalid: Record<string, any> = {}

  function absorb(code: string, raw: any, into: Record<string, any>, intoInvalid: Record<string, any>) {
    const parsed = parseNumericReading(raw)
    if (parsed.missing) return
    if (parsed.invalid) {
      intoInvalid[code] = parsed.raw
      return
    }
    into[code] = parsed.value
  }

  if (stage === "WINDER") {
    const rows = Array.isArray(entry?.dimension_readings) ? entry.dimension_readings : []
    rows.forEach((row: any, index: number) => {
      if (!sampleHasContent(row)) return
      const readings: Record<string, any> = {}
      const sampleInvalid: Record<string, any> = {}
      for (const code of ["id", "od", "height", "weight", "cs"]) {
        const raw = code === "height" ? (row?.height ?? row?.length) : row?.[code]
        absorb(code, raw, readings, sampleInvalid)
      }
      samples.push({
        sample_id: String(row?.sample_id || `W${index + 1}`),
        readings,
        invalid: Object.keys(sampleInvalid).length ? sampleInvalid : undefined,
      })
    })
    const qcReadings = entry?.qc_readings && typeof entry.qc_readings === "object" ? entry.qc_readings : {}
    for (const [key, value] of Object.entries(qcReadings)) {
      absorb(String(key), value, numeric, invalid)
    }
  }
  if (stage === "OVEN") {
    const aliases: Record<string, { keys: string[]; unit?: string; targetUnit: string }> = {
      pre_weight: { keys: ["pre_weight"], targetUnit: "g" },
      post_weight: { keys: ["post_weight"], targetUnit: "g" },
      pre_moisture: { keys: ["pre_moisture", "moisture_before"], targetUnit: "%" },
      post_moisture: { keys: ["post_moisture", "moisture_after"], targetUnit: "%" },
    }
    const readings: Record<string, any> = {}
    const sampleInvalid: Record<string, any> = {}
    const qcReadings = entry?.qc_readings && typeof entry.qc_readings === "object" ? entry.qc_readings : {}
    for (const [code, spec] of Object.entries(aliases)) {
      const raw = firstFilled({ ...entry, ...qcReadings }, spec.keys)
      absorb(code, raw, readings, sampleInvalid)
      if ((entry?.pre_oven_weight_kg || entry?.post_oven_weight_kg) && (code === "pre_weight" || code === "post_weight")) {
        const kgSource = code === "pre_weight" ? "pre_oven_weight_kg" : "post_oven_weight_kg"
        if (entry?.[kgSource] != null && String(entry[kgSource]).trim() !== "" && (readings[code] == null)) {
          unitConflicts.push({
            field: code,
            source: kgSource,
            source_unit: "kg",
            target_unit: "g",
          })
        }
      }
    }
    if (sampleHasContent(readings) || Object.keys(sampleInvalid).length) {
      samples.push({
        sample_id: String(entry?.qc_sample_id || entry?.sample_id || "OVEN-1"),
        readings,
        invalid: Object.keys(sampleInvalid).length ? sampleInvalid : undefined,
      })
    }
    Object.assign(numeric, readings)
    Object.assign(invalid, sampleInvalid)
  }
  if (stage === "PROCESS") {
    const measurements = { ...(entry?.final_measurements || {}), ...(entry?.qc_readings || {}) }
    const readings: Record<string, any> = {}
    const sampleInvalid: Record<string, any> = {}
    for (const code of ["height", "weight", "cs", "notch_distance", "notch_depth", "moisture"]) {
      const raw = code === "height" ? (measurements.height ?? measurements.length) : measurements[code]
      absorb(code, raw, readings, sampleInvalid)
    }
    if (sampleHasContent(readings) || Object.keys(sampleInvalid).length) {
      samples.push({
        sample_id: String(entry?.qc_sample_id || "P1"),
        readings,
        invalid: Object.keys(sampleInvalid).length ? sampleInvalid : undefined,
      })
    }
    Object.assign(numeric, readings)
    Object.assign(invalid, sampleInvalid)
  }

  if (samples.length && stage === "WINDER") {
    samples.forEach((sample) => {
      for (const [key, value] of Object.entries(sample.readings)) {
        if (numeric[key] == null) numeric[key] = value
      }
    })
  }

  const hasReadings = samples.some((sample) => Object.keys(sample.readings).length > 0) || Object.keys(numeric).length > 0
  return {
    readings: numeric,
    reasons,
    sample_id: String(entry?.qc_sample_id || samples[0]?.sample_id || "").trim() || undefined,
    samples,
    invalid,
    unit_conflicts: unitConflicts,
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
