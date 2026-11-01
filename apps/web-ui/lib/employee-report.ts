/**
 * Employee performance report (owner decision 7, 1 Nov 2026): plain-word helpers and the CSV the page
 * downloads. One row is one operator at one stage (quantities stay in the stage's unit).
 */

export type EmployeeRow = {
  operator_key: string
  operator_id?: string | null
  operator_name: string
  operator_code?: string | null
  department?: string | null
  stage: string
  stage_label?: string
  unit: string
  runs: number
  made: number
  good: number
  rejected: number
  reject_pct: number | null
  flagged_qc: number
  qc_readings: number
  shifts_worked: number
  days_worked: number
  hours: number | null
  last_activity: string | null
  sources?: string[]
}

export type EmployeeRun = {
  source: string
  kind: string
  run: string
  stage: string
  date: string | null
  shift: string | null
  made: number
  good: number
  rejected: number
  flagged_qc: number
  qc_readings: number
  hours: number | null
  job_card_id: string
  job_card_no: string | null
  customer?: string | null
  at?: string | null
}

export const STAGE_LABEL: Record<string, string> = { SLITTING: "Slitting", WINDER: "Winding", OVEN: "Oven", PROCESS: "Process", PACKING: "Packing" }

export const shiftWord = (value?: string | null) => (value ? String(value).replace("SHIFT_", "Shift ") : "—")
export const unitWord = (unit: string, count = 2) => (unit === "bamboo" ? (count === 1 ? "bamboo" : "bamboos") : "pcs")
export const departmentWord = (value?: string | null) => (value ? String(value).charAt(0) + String(value).slice(1).toLowerCase() : "Not in Masters")
export const pctWord = (value: number | null | undefined) => (value == null ? "—" : `${Number(value).toFixed(1)}%`)

function cell(value: unknown): string {
  const text = value == null ? "" : String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export const CSV_HEADER = [
  "Operator", "Code", "Department", "Stage", "Unit", "Runs", "Made", "Good", "Rejected", "Reject %",
  "Flagged QC readings", "QC readings", "Shifts worked", "Days worked", "Hours on card", "Last activity",
]

/** The report as CSV (Excel opens it): one line per operator and stage, then the filters it was run with. */
export function employeeCsv(rows: EmployeeRow[], filters: { from: string; to: string; shift?: string; stage?: string; department?: string }): string {
  const lines = [CSV_HEADER.map(cell).join(",")]
  for (const row of rows) {
    lines.push([
      row.operator_name, row.operator_code || "", row.department || "", STAGE_LABEL[row.stage] || row.stage, unitWord(row.unit),
      row.runs, row.made, row.good, row.rejected, row.reject_pct == null ? "" : row.reject_pct.toFixed(1),
      row.flagged_qc, row.qc_readings, row.shifts_worked, row.days_worked, row.hours == null ? "" : row.hours, row.last_activity || "",
    ].map(cell).join(","))
  }
  lines.push("")
  lines.push(["Period", `${filters.from} to ${filters.to}`].map(cell).join(","))
  lines.push(["Shift", filters.shift ? shiftWord(filters.shift) : "All shifts"].map(cell).join(","))
  lines.push(["Stage", filters.stage ? STAGE_LABEL[filters.stage] || filters.stage : "All stages"].map(cell).join(","))
  lines.push(["Department", filters.department ? departmentWord(filters.department) : "All departments"].map(cell).join(","))
  return lines.join("\n")
}

/** Rows of one operator together, the operator with the most runs first. */
export function byOperator(rows: EmployeeRow[]): Array<{ key: string; name: string; code?: string | null; department?: string | null; rows: EmployeeRow[]; runs: number }> {
  const groups = new Map<string, { key: string; name: string; code?: string | null; department?: string | null; rows: EmployeeRow[]; runs: number }>()
  for (const row of rows) {
    const group = groups.get(row.operator_key) || { key: row.operator_key, name: row.operator_name, code: row.operator_code, department: row.department, rows: [], runs: 0 }
    group.rows.push(row)
    group.runs += row.runs
    groups.set(row.operator_key, group)
  }
  return [...groups.values()].sort((a, b) => b.runs - a.runs || a.name.localeCompare(b.name))
}
