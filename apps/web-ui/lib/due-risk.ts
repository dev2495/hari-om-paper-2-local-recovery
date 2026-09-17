export const PLANT_TIMEZONE = "Asia/Kolkata"
export const PRIORITY_WINDOW_DAYS = 3
export const DUE_RISK_PRIORITY = "PRIORITY"
export const DUE_RISK_OVERDUE = "OVERDUE"

export function plantToday(now = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: PLANT_TIMEZONE })
}

export function addPlantDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number)
  const utc = Date.UTC(year, month - 1, day + days)
  const next = new Date(utc)
  const y = next.getUTCFullYear()
  const m = String(next.getUTCMonth() + 1).padStart(2, "0")
  const d = String(next.getUTCDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

export function priorityWindow(today = plantToday()) {
  return { start: today, end: addPlantDays(today, PRIORITY_WINDOW_DAYS - 1) }
}

export function classifyDueRisk(dueDate?: string | null, today = plantToday()): string | null {
  if (!dueDate) return null
  const due = String(dueDate).slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return null
  if (due < today) return DUE_RISK_OVERDUE
  const { end } = priorityWindow(today)
  if (due <= end) return DUE_RISK_PRIORITY
  return null
}

export function dueRiskLabel(today = plantToday()) {
  const { start, end } = priorityWindow(today)
  const format = (value: string) => {
    const parsed = new Date(`${value}T00:00:00+05:30`)
    return parsed.toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: PLANT_TIMEZONE })
  }
  return `Priority delivery — next 3 plant days (${format(start)}–${format(end)}, ${PLANT_TIMEZONE})`
}

export function overdueLabel() {
  return "Overdue (due before today, plant calendar)"
}
