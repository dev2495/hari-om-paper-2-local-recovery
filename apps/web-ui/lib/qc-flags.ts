/**
 * In-process QC flags (client 2026-10-27: "allow QC entry above tolerance but flag it everywhere;
 * no hold for now; trace all flagged QC easily, stage-wise").
 *
 * Rows come from `GET /api/production/quality/flags` (one row per reading outside its band) and
 * `GET /api/production/entries/qc-due` (runs whose QC is not done yet). Pure helpers, unit tested.
 */

export type QcFlagRow = {
  entry_id: string
  entry_no?: number | null
  run?: string | null
  status?: string | null
  job_card_id: string
  job_card_no?: string | null
  customer?: string | null
  sales_order_no?: string | null
  stage: string
  stage_label?: string | null
  business_date?: string | null
  shift_code?: string | null
  machine_id?: string | null
  operator?: string | null
  logged_by?: string | null
  logged_at?: string | null
  sample_id?: string | null
  parameter?: string | null
  label: string
  unit?: string | null
  value?: number | null
  min?: number | null
  max?: number | null
  direction?: "HIGH" | "LOW" | null
}

export type QcDueRow = {
  entry_id: string
  job_card_id: string
  job_card_no?: string | null
  customer?: string | null
  stage: string
  stage_label?: string | null
  entry_no?: number | null
  business_date?: string | null
  shift_code?: string | null
  accepted?: number | null
  unit?: string | null
  state?: "FAILED" | "NO_READINGS" | "MORE_READINGS" | "INCOMPLETE" | string
  readings_short?: { parameter?: string; label?: string; have?: number; need?: number }[]
  samples?: number | null
  created_at?: string | null
}

export const QC_STAGES = [
  { key: "WINDER", label: "Winding" },
  { key: "OVEN", label: "Oven" },
  { key: "PROCESS", label: "Process" },
] as const

export const STAGE_LABEL: Record<string, string> = { WINDER: "Winding", OVEN: "Oven", PROCESS: "Process", QC: "Final QC", PACKING: "Packing", SLITTING: "Slitting" }

export const shiftLabel = (code?: string | null) => (code ? String(code).replace(/^SHIFT_/, "Shift ") : "—")

/** "27 Oct" (Indian short date) for a yyyy-mm-dd business date. */
export function indianDay(value?: string | null, withYear = false) {
  if (!value) return "—"
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}) })
}

/** Server timestamps are UTC without a zone: show them in local (IST) time. */
export function indianTime(value?: string | null) {
  if (!value) return ""
  const date = new Date(/Z$|[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}Z`)
  if (Number.isNaN(date.getTime())) return ""
  return date.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
}

const num = (value: number) => Number(value).toLocaleString("en-IN", { maximumFractionDigits: 3 })

export function bandText(min?: number | null, max?: number | null, unit?: string | null) {
  const u = unit ? ` ${unit}` : ""
  if (min != null && max != null) return `${num(min)}–${num(max)}${u}`
  if (min != null) return `at least ${num(min)}${u}`
  if (max != null) return `at most ${num(max)}${u}`
  return "no band"
}

/** How far the reading is outside its band (always positive), or null when it cannot be worked out. */
export function offBy(row: Pick<QcFlagRow, "value" | "min" | "max" | "direction">) {
  if (row.value == null) return null
  if (row.direction === "HIGH" && row.max != null) return Math.round((row.value - row.max) * 1000) / 1000
  if (row.direction === "LOW" && row.min != null) return Math.round((row.min - row.value) * 1000) / 1000
  return null
}

export function directionWord(direction?: string | null) {
  return direction === "HIGH" ? "High" : direction === "LOW" ? "Low" : "Outside band"
}

/** "Flagged · I.D. 76.9 mm (band 76.2–76.5)" — the words shown wherever a flag appears. */
export function flagLine(row: Pick<QcFlagRow, "label" | "value" | "min" | "max" | "unit">) {
  const value = row.value == null ? "—" : `${num(row.value)}${row.unit ? ` ${row.unit}` : ""}`
  return `Flagged · ${row.label} ${value} (band ${bandText(row.min, row.max)})`
}

export function flagMatches(row: QcFlagRow, needle: string) {
  const query = needle.trim().toLowerCase()
  if (!query) return true
  return [row.job_card_no, row.customer, row.sales_order_no, row.operator, row.logged_by, row.label]
    .some((value) => String(value || "").toLowerCase().includes(query))
}

export type ParameterSummary = {
  key: string
  stage: string
  label: string
  unit?: string | null
  readings: number
  high: number
  low: number
  runs: number
  cards: number
  worst: number | null
}

/** Flagged readings per stage and check, most readings first (stage order Winding, Oven, Process). */
export function parameterSummary(rows: QcFlagRow[]): ParameterSummary[] {
  const groups = new Map<string, { rows: QcFlagRow[] }>()
  for (const row of rows) {
    const key = `${row.stage}:${row.label}`
    if (!groups.has(key)) groups.set(key, { rows: [] })
    groups.get(key)!.rows.push(row)
  }
  const order = (stage: string) => {
    const index = QC_STAGES.findIndex((item) => item.key === stage)
    return index < 0 ? 9 : index
  }
  return Array.from(groups.entries())
    .map(([key, { rows: list }]) => {
      const offs = list.map(offBy).filter((value): value is number => value != null)
      return {
        key,
        stage: list[0].stage,
        label: list[0].label,
        unit: list[0].unit,
        readings: list.length,
        high: list.filter((row) => row.direction === "HIGH").length,
        low: list.filter((row) => row.direction === "LOW").length,
        runs: new Set(list.map((row) => row.entry_id)).size,
        cards: new Set(list.map((row) => row.job_card_id)).size,
        worst: offs.length ? Math.max(...offs) : null,
      }
    })
    .sort((a, b) => order(a.stage) - order(b.stage) || b.readings - a.readings || a.label.localeCompare(b.label))
}

/** Count of flagged readings, runs and cards per stage (for the stage tabs and the chart). */
export function stageCounts(rows: QcFlagRow[]) {
  return QC_STAGES.map(({ key, label }) => {
    const list = rows.filter((row) => row.stage === key)
    return {
      stage: key,
      label,
      readings: list.length,
      high: list.filter((row) => row.direction === "HIGH").length,
      low: list.filter((row) => row.direction === "LOW").length,
      runs: new Set(list.map((row) => row.entry_id)).size,
      cards: new Set(list.map((row) => row.job_card_id)).size,
    }
  })
}

/** What a waiting run still needs: "I.D. 1/2 · O.D. 0/2" (readings have / need per check). */
export function missingText(row: Pick<QcDueRow, "readings_short" | "state">) {
  const short = Array.isArray(row.readings_short) ? row.readings_short : []
  if (!short.length) return row.state === "NO_READINGS" ? "No readings yet" : "Readings incomplete"
  return short.map((item) => `${item.label || item.parameter} ${item.have ?? 0}/${item.need ?? 2}`).join(" · ")
}

export function waitingState(row: Pick<QcDueRow, "state">) {
  switch (row.state) {
    case "NO_READINGS":
      return "No readings yet"
    case "MORE_READINGS":
      return "More readings needed"
    case "FAILED":
      return "Flagged · more readings needed"
    default:
      return "Readings incomplete"
  }
}

/** Floor entry page in QC mode for one stage (operators log QC there). */
export function logQcHref(jobCardId: string, stage: string) {
  return `/production/entry/${encodeURIComponent(jobCardId)}?mode=qc&stage=${encodeURIComponent(stage)}`
}
