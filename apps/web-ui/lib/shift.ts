/** SHIFT_A / SHIFT_B from how a shift is written ("A", "Shift A", "shift-b"); "" when blank or unknown. */
export function canonicalShift(value: unknown): "SHIFT_A" | "SHIFT_B" | "" {
  const key = String(value ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_").replace(/^SHIFT_?/, "")
  if (key === "A") return "SHIFT_A"
  if (key === "B") return "SHIFT_B"
  return ""
}

export type ShiftCode = "SHIFT_A" | "SHIFT_B"

/**
 * The shift rule (same as production `lifecycle_rules.SHIFT_START`): Shift A runs 08:00–20:00 IST and
 * Shift B 20:00–08:00 IST. The business date is the day the shift started, so 01:30 IST on 31 Oct is
 * Shift B of 30 Oct. Always India time, whatever the browser's own time zone is.
 */
export const SHIFT_START_MINUTES: Record<ShiftCode, number> = { SHIFT_A: 8 * 60, SHIFT_B: 20 * 60 }
const IST_OFFSET_MINUTES = 330

/** India calendar date and minutes since midnight for a moment. */
function istParts(now: Date): { date: string; minutes: number } {
  const ist = new Date(now.getTime() + IST_OFFSET_MINUTES * 60_000)
  return { date: ist.toISOString().slice(0, 10), minutes: ist.getUTCHours() * 60 + ist.getUTCMinutes() }
}

/** "YYYY-MM-DD" plus or minus whole days (no time-zone drift). */
export function addDays(day: string, days: number): string {
  const moment = new Date(`${day}T00:00:00Z`)
  moment.setUTCDate(moment.getUTCDate() + days)
  return moment.toISOString().slice(0, 10)
}

/** Today's India calendar date ("YYYY-MM-DD"). */
export function istToday(now: Date = new Date()): string {
  return istParts(now).date
}

/** The running shift and its business date by the shift rule. */
export function shiftSlotNow(now: Date = new Date()): { date: string; shift: ShiftCode } {
  const { date, minutes } = istParts(now)
  if (minutes >= SHIFT_START_MINUTES.SHIFT_A && minutes < SHIFT_START_MINUTES.SHIFT_B) return { date, shift: "SHIFT_A" }
  if (minutes >= SHIFT_START_MINUTES.SHIFT_B) return { date, shift: "SHIFT_B" }
  return { date: addDays(date, -1), shift: "SHIFT_B" }
}

/**
 * Business date of the latest started run of a shift: at 01:30 IST both shifts are yesterday; at 10:00 IST
 * Shift A is today and Shift B (the night just ended) is yesterday.
 */
export function shiftBusinessDate(shift: unknown, now: Date = new Date()): string {
  const slot = shiftSlotNow(now)
  return canonicalShift(shift) === "SHIFT_B" && slot.shift === "SHIFT_A" ? addDays(slot.date, -1) : slot.date
}

/** "30 Oct" for a "YYYY-MM-DD" business date (no time-zone drift). */
function dayWords(day: string): string {
  const moment = new Date(`${String(day).slice(0, 10)}T00:00:00Z`)
  return Number.isNaN(moment.getTime()) ? "" : moment.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })
}

/** "Shift B · 30 Oct" for the running shift. */
export function shiftNowLabel(now: Date = new Date()): string {
  return shiftAt(now).label
}

/**
 * The shift a moment belongs to, for the issue desks and the floor: { shift: "B", code: "SHIFT_B",
 * businessDate: "2026-10-30", label: "Shift B · 30 Oct", clock: "01:30" } at 01:30 IST on 31 Oct.
 */
export function shiftAt(now: Date = new Date()): { shift: "A" | "B"; code: ShiftCode; businessDate: string; label: string; clock: string } {
  const slot = shiftSlotNow(now)
  const { minutes } = istParts(now)
  const letter = slot.shift === "SHIFT_A" ? "A" : "B"
  return {
    shift: letter,
    code: slot.shift,
    businessDate: slot.date,
    label: `Shift ${letter} · ${dayWords(slot.date)}`,
    clock: `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`,
  }
}

/** "Shift B · 30 Oct" for a recorded shift and business date; older "General" issues read "General shift". */
export function shiftWords(shift: unknown, businessDate?: string | null): string {
  const code = canonicalShift(shift)
  const raw = String(shift ?? "").trim()
  const name = code ? `Shift ${code === "SHIFT_A" ? "A" : "B"}` : raw ? `${raw.charAt(0).toUpperCase()}${raw.slice(1).toLowerCase()} shift` : ""
  const day = businessDate ? dayWords(businessDate) : ""
  if (!name && !day) return "Shift not recorded"
  return [name || "Shift not recorded", day].filter(Boolean).join(" · ")
}
