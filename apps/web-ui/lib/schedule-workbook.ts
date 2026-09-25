import type { Worksheet } from "exceljs"

export type ScheduleSourceCell = { date: string; header: string; qty: number; cell: string }
/** Only the first contiguous dated table is the RM calendar. Summary, vendor and FG tables are not arrivals. */
export function parseScheduleSheet(sheet: Worksheet): { rows: ScheduleSourceCell[]; ignoredDatedRows: number } {
  const dayOf = (value: unknown): string | null => {
    if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString().slice(0, 10)
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value
    return null
  }
  const headers: Record<number, string> = {}; const rows: ScheduleSourceCell[] = []
  let started = false; let ended = false; let ignoredDatedRows = 0
  sheet.eachRow({ includeEmpty: true }, (row) => {
    let date: string | null = null; let dateColumn = 0
    row.eachCell((cell, column) => { const parsed = dayOf(cell.value); if (parsed && !date) { date = parsed; dateColumn = column } })
    if (!date) {
      if (started) ended = true
      else row.eachCell((cell, column) => { if (!headers[column] && typeof cell.value === "string" && cell.value.trim()) headers[column] = cell.value.trim() })
      return
    }
    if (ended) { ignoredDatedRows++; return }
    started = true
    row.eachCell((cell, column) => {
      // Formula results in daily cells are values. Footer totals are outside this table.
      const value = typeof cell.value === "object" && cell.value && "result" in cell.value ? cell.value.result : cell.value
      if (column <= dateColumn || typeof value !== "number" || !Number.isFinite(value) || value <= 0 || !headers[column] || /^(total( kg)?|day|vehi(?:cle)?s?(?: count)?)$/i.test(headers[column])) return
      rows.push({ date: date!, header: headers[column], qty: value, cell: cell.address })
    })
  })
  return { rows, ignoredDatedRows }
}

/** Reel/slitted columns may map to the same item. Sum them instead of dropping a column. */
export function mergeScheduleCells(rows: (ScheduleSourceCell & { item_id: string })[], factor: number) {
  const quantities: Record<string, number> = {}; const sources: Record<string, ScheduleSourceCell[]> = {}
  rows.forEach((row) => { const key = `${row.date}:${row.item_id}`; quantities[key] = Math.round(((quantities[key] || 0) + row.qty * factor) * 1000) / 1000; (sources[key] ||= []).push(row) })
  return { cells: Object.fromEntries(Object.entries(quantities).map(([key, qty]) => [key, String(qty)])), sources }
}
