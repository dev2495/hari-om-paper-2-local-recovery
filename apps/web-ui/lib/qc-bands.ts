/**
 * Inward QC band types shared by the master-row popup and Masters › Inward QC tolerances.
 *
 * Client 2026-10-18: give the tolerance ("± 0.05"), and rules like "GSM / BF / polybond at least
 * the required value" — so ± comes first and "at least / at most the master value" are bands too.
 */
export type BandMode = "PLUS_MINUS" | "PERCENT" | "AT_LEAST" | "AT_MOST" | "RANGE" | "NONE"
export type BandLine = { mode: BandMode; min: string; max: string; spread: string }

export const BAND_MODES: { value: BandMode; label: string }[] = [
  { value: "PLUS_MINUS", label: "± value" },
  { value: "PERCENT", label: "± %" },
  { value: "AT_LEAST", label: "≥ master value" },
  { value: "AT_MOST", label: "≤ master value" },
  { value: "RANGE", label: "Min – max" },
  { value: "NONE", label: "No band here" },
]

export const blankBand: BandLine = { mode: "PLUS_MINUS", min: "", max: "", spread: "" }

const num = (value: unknown) => (value === null || value === undefined || value === "" ? "" : String(Number(value)))
export const showNumber = (value: unknown) =>
  value === null || value === undefined || value === "" || !Number.isFinite(Number(value)) ? "—" : Number(value).toLocaleString("en-IN", { maximumFractionDigits: 4 })

/** Editor line for a saved band row (or a blank ± line). */
export function bandLineFrom(row: any): BandLine {
  if (!row) return { ...blankBand }
  return { mode: (row.mode || "RANGE") as BandMode, min: num(row.min_value), max: num(row.max_value), spread: num(row.tolerance_value) }
}

/** What the save sends for one check. "No band here" clears this scope's band. */
export function bandPayload(parameterKey: string, line: BandLine) {
  if (line.mode === "RANGE") return { parameter_key: parameterKey, mode: "RANGE" as const, min_value: line.min === "" ? null : Number(line.min), max_value: line.max === "" ? null : Number(line.max) }
  if (line.mode === "NONE") return { parameter_key: parameterKey, mode: "PLUS_MINUS" as const, tolerance_value: null }
  if (line.mode === "AT_LEAST" || line.mode === "AT_MOST") return { parameter_key: parameterKey, mode: line.mode, tolerance_value: line.spread === "" ? 0 : Math.abs(Number(line.spread)) }
  return { parameter_key: parameterKey, mode: line.mode, tolerance_value: line.spread === "" ? null : Number(line.spread) }
}

/** A saved or edited band in words, e.g. "0.305 to 0.355 (± 0.025)" or "at least 230". */
export function describeBand(band: any, nominal?: number | null, unit = ""): string {
  if (!band || band.mode === "NONE") return "none"
  const suffix = unit ? ` ${unit}` : ""
  const hasNominal = nominal !== null && nominal !== undefined && Number.isFinite(Number(nominal))
  if (band.mode === "RANGE") {
    if (band.min_value != null && band.max_value != null) return `${showNumber(band.min_value)} to ${showNumber(band.max_value)}${suffix}`
    if (band.min_value != null) return `at least ${showNumber(band.min_value)}${suffix}`
    if (band.max_value != null) return `at most ${showNumber(band.max_value)}${suffix}`
    return "none"
  }
  const spread = Math.abs(Number(band.tolerance_value || 0))
  if (band.mode === "AT_LEAST" || band.mode === "AT_MOST") {
    const word = band.mode === "AT_LEAST" ? "at least" : "at most"
    if (!hasNominal) return `${word} the line's master value${spread ? ` ${band.mode === "AT_LEAST" ? "less" : "plus"} ${showNumber(spread)}` : ""}`
    return `${word} ${showNumber(band.mode === "AT_LEAST" ? Number(nominal) - spread : Number(nominal) + spread)}${suffix}`
  }
  const percent = band.mode === "PERCENT" ? "%" : ""
  if (!hasNominal) return `± ${showNumber(spread)}${percent} around the line's master value`
  const width = band.mode === "PERCENT" ? Math.abs(Number(nominal)) * spread / 100 : spread
  return `${showNumber(Number(nominal) - width)} to ${showNumber(Number(nominal) + width)}${suffix} (± ${showNumber(spread)}${percent})`
}

/** Preview of an edited line; null when the line sets no band. */
export function previewBand(line: BandLine, nominal: number | null, perLine: boolean, unit = ""): string | null {
  if (line.mode === "NONE") return "No band here — the band above applies, or the reading is recorded only"
  if (line.mode === "RANGE") return line.min || line.max ? describeBand({ mode: "RANGE", min_value: line.min === "" ? null : Number(line.min), max_value: line.max === "" ? null : Number(line.max) }, null, unit) : null
  const relative = line.mode === "AT_LEAST" || line.mode === "AT_MOST"
  if (!relative && !line.spread) return null
  const band = { mode: line.mode, tolerance_value: line.spread === "" ? 0 : Number(line.spread) }
  if (perLine) return nominal === null ? `${describeBand(band, null)} — enter the nominal to centre it on` : describeBand(band, nominal, unit)
  return `${describeBand(band, null)} (each line's own value)`
}
