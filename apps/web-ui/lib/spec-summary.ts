type DynamicFieldRow = {
  field_key?: string | null
  value?: unknown
}

type TubeSizeSummary = {
  name?: string | null
  internal_code?: string | null
  inner_diameter_mm?: unknown
  outer_diameter_mm?: unknown
  length_mm?: unknown
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const number = finiteNumber(value)
    if (number !== null) return number
  }
  return null
}

function midpoint(minimum: unknown, maximum: unknown): number | null {
  const min = finiteNumber(minimum)
  const max = finiteNumber(maximum)
  if (min !== null && max !== null) return (min + max) / 2
  return min ?? max
}

function dynamicValue(spec: any, fieldKey: string): unknown {
  const row = (Array.isArray(spec?.dynamic_fields) ? spec.dynamic_fields : []).find(
    (entry: DynamicFieldRow) => String(entry?.field_key || "") === fieldKey,
  )
  return row?.value
}

export function formatSpecMeasure(value: number | null, maximumFractionDigits = 2): string {
  if (value === null || !Number.isFinite(value)) return "-"
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  }).format(value)
}

export function resolveSpecSummary(spec: any, tubeSize?: TubeSizeSummary | null) {
  const dimensions = spec?.profile?.dimensions || {}
  const quality = spec?.profile?.quality_targets || {}

  const idMm = firstNumber(
    dimensions?.id_mm?.avg,
    midpoint(spec?.id_min_mm, spec?.id_max_mm),
    tubeSize?.inner_diameter_mm,
  )
  const odMm = firstNumber(
    dimensions?.od_mm?.avg,
    midpoint(spec?.od_min_mm, spec?.od_max_mm),
    tubeSize?.outer_diameter_mm,
  )
  const designLengthMm = firstNumber(
    dimensions?.length_mm?.avg,
    midpoint(spec?.length_min_mm, spec?.length_max_mm),
    tubeSize?.length_mm,
  )
  // Actual height is a display-only override. It must never replace the tube
  // master/design length used by recipe, yield, trim, or consumption math.
  const enteredActualHeight = finiteNumber(dynamicValue(spec, "actual_tube_height_mm"))
  const masterHeight = finiteNumber(tubeSize?.length_mm)
  const actualHeightMm = enteredActualHeight !== null && enteredActualHeight > 0
    ? enteredActualHeight
    : masterHeight ?? designLengthMm
  const targetWeightG = firstNumber(
    quality?.tube_weight_g?.avg,
    spec?.target_tube_weight,
    midpoint(spec?.weight_min_g, spec?.weight_max_g),
  )
  const requiredCs = firstNumber(
    quality?.cs_n?.avg,
    spec?.approved_cs,
    spec?.required_cs,
    midpoint(spec?.cs_min_n, spec?.cs_max_n),
  )

  const dimensionLabel = [idMm, odMm, designLengthMm]
    .map((value) => formatSpecMeasure(value))
    .join(" × ")
  const tubeLabel = String(tubeSize?.name || tubeSize?.internal_code || "").trim() ||
    (dimensionLabel === "- × - × -" ? "Tube size pending" : `${dimensionLabel} mm`)

  return {
    idMm,
    odMm,
    designLengthMm,
    actualHeightMm,
    actualHeightSource: enteredActualHeight !== null && enteredActualHeight > 0
      ? "entered"
      : masterHeight !== null
        ? "tube-master"
        : "spec-default",
    targetWeightG,
    requiredCs,
    tubeLabel,
  }
}
