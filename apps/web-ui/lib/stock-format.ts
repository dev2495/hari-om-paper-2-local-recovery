/**
 * Plain words, quantities and dates for the stock pages (client 2026-10-28): en-IN numbers with the unit,
 * Indian dates in IST, never a code shown to a person. No app imports, so unit tests load it directly.
 */

import { personLabel } from "./people"

export type Tone = "emerald" | "amber" | "rose" | "blue" | "slate" | "violet"
export type Uom = "KG" | "PCS" | "L" | string
export type UnitTotal = { uom: Uom; qty: number }
export type RackStatus = "TODO" | "COUNTING" | "DONE" | "RECOUNT"

const UNIT_WORD: Record<string, string> = { KG: "kg", PCS: "pcs", NOS: "nos", L: "L", LTR: "L", LITRE: "L", MTR: "m", M: "m", BOX: "boxes", ROLL: "rolls", SET: "sets", PKT: "packets", BAG: "bags", DRUM: "drums" }
const UNIT_NAME: Record<string, string> = { KG: "kg", PCS: "pieces", NOS: "numbers", L: "litres", LTR: "litres", LITRE: "litres", MTR: "metres", M: "metres", BOX: "boxes", ROLL: "rolls", SET: "sets", PKT: "packets", BAG: "bags", DRUM: "drums" }
/** Units counted in whole things: no decimal point on the keypad, numbers rounded. */
const WHOLE_UNITS = new Set(["PCS", "NOS", "BOX", "ROLL", "SET", "PKT", "BAG", "DRUM"])

/** The short unit after a number: "kg", "pcs", "L", "boxes" (an unknown unit is shown in lower case). */
export function unitWord(uom: Uom | null | undefined): string {
  const key = String(uom || "").toUpperCase()
  return UNIT_WORD[key] ?? key.toLowerCase()
}

/** The unit in words for a heading: "kg", "pieces", "litres". */
export function unitName(uom: Uom | null | undefined): string {
  const key = String(uom || "").toUpperCase()
  return UNIT_NAME[key] ?? key.toLowerCase()
}

export function isWholeUnit(uom: Uom | null | undefined): boolean {
  return WHOLE_UNITS.has(String(uom || "").toUpperCase())
}

/** "1,234.5 kg", "40 pcs", "−60 pcs" — en-IN numbers with the unit, never a bare number. */
export function qtyText(value: number | null | undefined, uom: Uom = "KG", digits = 3): string {
  const number = Number(value ?? 0)
  const shown = isWholeUnit(uom) ? Math.round(number) : number
  const text = Math.abs(shown).toLocaleString("en-IN", { maximumFractionDigits: digits })
  return `${shown < 0 && text !== "0" ? "−" : ""}${text} ${unitWord(uom)}`.trim()
}

/** "1 rack", "3 racks"; pass the plural when it is not just "+s". */
export function plural(count: number, word: string, many = `${word}s`): string {
  return `${count.toLocaleString("en-IN")} ${count === 1 ? word : many}`
}

/** Signed difference: "+5 kg", "−10 kg", "0 kg". */
export function signedQty(value: number, uom: Uom = "KG"): string {
  if (Math.abs(value) < 0.0005) return qtyText(0, uom)
  return `${value > 0 ? "+" : "−"}${qtyText(Math.abs(value), uom)}`
}

/** One line per unit, e.g. "4,320 kg · 40 pcs"; kg and pcs are never added together. */
export function unitTotalsText(totals: UnitTotal[] | undefined): string {
  return (totals || []).filter((row) => Math.abs(row.qty) > 0.0005).map((row) => qtyText(row.qty, row.uom)).join(" · ")
}

export function rupees(value: number): string {
  const sign = value < 0 ? "−" : ""
  return `${sign}₹${Math.abs(value).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`
}

/** "27 Oct 2026" for a YYYY-MM-DD day or a server timestamp (naive UTC), shown in IST. */
export function dayText(value: string | null | undefined): string {
  if (!value) return ""
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-").map(Number)
    return `${d} ${MONTHS[m - 1]} ${y}`
  }
  const date = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value}Z`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" })
}

/** "27 Oct, 4:05 pm" in IST for a naive-UTC server timestamp. */
export function timeText(value: string | null | undefined): string {
  if (!value) return ""
  const date = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value}Z`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" })
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const LONG_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

/** "October 2026" for "2026-10". */
export function monthText(month: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(month || "")
  return match ? `${LONG_MONTHS[Number(match[2]) - 1]} ${match[1]}` : month
}

/** The month before / after a "YYYY-MM" month, as "YYYY-MM" (pure string maths, no time zones). */
export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number)
  const index = y * 12 + (m - 1) + by
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`
}

/** The person part of a login: "store.maker@hariom.com" → "store.maker". */
export function who(value: string | null | undefined): string {
  return personLabel(value, "—") // the people-directory name once known (client 2026-10-28: names, not logins)
}

export const COUNT_STATUS_TONE: Record<string, Tone> = { DRAFT: "blue", SUBMITTED: "amber", APPROVED: "emerald", CERTIFIED: "emerald", CANCELLED: "slate" }
export const RACK_STATUS: Record<RackStatus, { word: string; tone: Tone }> = {
  TODO: { word: "To count", tone: "slate" },
  COUNTING: { word: "Counting", tone: "blue" },
  DONE: { word: "Done", tone: "emerald" },
  RECOUNT: { word: "Count again", tone: "amber" },
}
export const PURPOSE_WORD: Record<string, string> = { STORAGE: "Store rack", QC: "QC bay", SCRAP: "Scrap area", DISPATCH: "Dispatch bay", WIP: "Production floor" }

const REASON_WORDS: Record<string, string> = {
  COUNT_SHORT: "Count short", COUNT_EXTRA: "Count extra", DAMAGED_IN_STORE: "Damaged in store", WRONG_GRN_WEIGHT: "Wrong GRN weight",
  LABEL_LOST_FOUND: "Label lost / found", OTHER: "Other", FLOOR_ISSUE: "Floor issue", FLOOR_RETURN: "Returned from the floor (old)",
  CUSTOMER_REJECTION_SCRAP: "Customer complaint scrap", SUPPLIER_RETURN: "Sent back to supplier", QC_REJECTED: "Rejected at QC",
  PHYSICAL_COUNT_VARIANCE: "", // the chip already says "Count difference"
}

/** A stored reason code in words ("COUNT_SHORT" → "Count short"); "" when the chip already says it. */
export function reasonWord(code: string | null | undefined): string {
  const key = String(code || "").trim().toUpperCase()
  if (!key) return ""
  if (key in REASON_WORDS) return REASON_WORDS[key]
  // Free text (a typed reason) stays as typed; an unknown CODE_LIKE value reads as plain words.
  if (!/^[A-Z0-9_]+$/.test(key) || !key.includes("_")) return String(code)
  const words = key.toLowerCase().replace(/_/g, " ")
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** Where a lot sits, the same on every desk: the rack's plain name, its label code in brackets ("RM store (RM-STORE)"). */
export function placeText(place: { code?: string | null; name?: string | null } | null | undefined): string {
  if (!place?.code && !place?.name) return ""
  const code = String(place.code || "").trim()
  const name = String(place.name || "").trim()
  return name && code && name !== code ? `${name} (${code})` : name || code
}

/** "Pick from RM store (RM-STORE)" beside a lot on the issue desks; "No rack yet" when it has no place. */
export function pickFromText(place: { code?: string | null; name?: string | null } | null | undefined): string {
  const where = placeText(place)
  return where ? `Pick from ${where}` : "No rack yet"
}

/** A label read by the server as a rack label (scan boxes say so instead of "not found"). */
export function errorText(error: any, fallback = "Something went wrong. Try again."): string {
  const detail = error?.response?.data?.detail ?? error?.response?.data
  if (typeof detail === "string") return detail
  if (detail && typeof detail.message === "string") return detail.message
  // A form check from the server ("Input should be a valid UUID…") is developer text: say it in plain words.
  if (Array.isArray(detail)) return error?.response?.status === 422 ? "Something in this request is not valid. Check it and try again." : fallback
  return error?.message && !/status code/i.test(error.message) ? error.message : fallback
}

/** The refusal code: services send {detail: {code}}, BFF guards send a top-level {code} (both on BOOKS_LOCKED). */
export function errorCode(error: any): string {
  const data = error?.response?.data
  const detail = data?.detail
  if (detail && typeof detail === "object" && typeof detail.code === "string") return detail.code
  return data && typeof data === "object" && typeof data.code === "string" ? data.code : ""
}

/** A fresh idempotency key for one scan / move (a retried request never counts twice). */
export function clientRef(prefix = "scan"): string {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `${prefix}-${random}`
}

/** "since today", "1 day here", "12 days here" — from when a lot came to the place it is now (naive-UTC stamp or a day). */
export function daysHere(value: string | null | undefined, now: Date = new Date()): string {
  if (!value) return ""
  const at = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00+05:30`) : new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value}Z`)
  if (Number.isNaN(at.getTime())) return ""
  // Whole IST days between the two moments' calendar days.
  const day = (date: Date) => Math.floor((date.getTime() + 5.5 * 3600000) / 86400000)
  const days = day(now) - day(at)
  return days <= 0 ? "here since today" : days === 1 ? "1 day here" : `${days} days here`
}
