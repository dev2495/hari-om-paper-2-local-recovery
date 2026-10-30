/**
 * Plain-words formatting for the RM inward calendar: Indian dates ("27 Oct 2026"), en-IN quantities
 * with the unit ("1,234.5 kg", "40 pcs"), arrival states with a word, and Monday weeks.
 * Dates are business dates ("YYYY-MM-DD"); maths runs in UTC so no time zone can shift a day.
 */
import type { Arrival, ArrivalState, CalendarMaterial, MaterialClass } from "@/lib/api-rm-calendar"
import { knownPersonName } from "../../../lib/people"

const DAY_MS = 86_400_000

export function toUtc(day: string): number {
  const [year, month, date] = day.slice(0, 10).split("-").map(Number)
  return Date.UTC(year, month - 1, date)
}

export function fromUtc(value: number): string {
  return new Date(value).toISOString().slice(0, 10)
}

export function addDays(day: string, count: number): string {
  return fromUtc(toUtc(day) + count * DAY_MS)
}

export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS)
}

/** Monday of the week that holds ``day`` (weeks run Monday to Sunday, like the PO grouping). */
export function weekStart(day: string): string {
  const weekday = new Date(toUtc(day)).getUTCDay() // 0 Sunday
  return addDays(day, -((weekday + 6) % 7))
}

/** Rolling weeks: seven days at a time from the first day of the window (today), never past days. */
export function chunkDays(days: string[], size = 7): string[][] {
  const out: string[][] = []
  for (let index = 0; index < days.length; index += size) out.push(days.slice(index, index + size))
  return out
}

export function weeksOf(days: string[]): string[][] {
  if (!days.length) return []
  const out: string[][] = []
  let monday = weekStart(days[0])
  const last = days[days.length - 1]
  while (monday <= last) {
    out.push(Array.from({ length: 7 }, (_, index) => addDays(monday, index)))
    monday = addDays(monday, 7)
  }
  return out
}

const fmt = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", ...options })
const LONG = fmt({ day: "numeric", month: "short", year: "numeric" })
const SHORT = fmt({ day: "numeric", month: "short" })
const WEEKDAY = fmt({ weekday: "short" })
const MONTH = fmt({ month: "long", year: "numeric" })

/** "27 Oct 2026" */
export function longDate(day?: string | null): string {
  return day ? LONG.format(new Date(toUtc(day))).replace(/,/g, "") : "—"
}

/** "27 Oct" */
export function shortDate(day?: string | null): string {
  return day ? SHORT.format(new Date(toUtc(day))) : "—"
}

/** "Wed" */
export function weekday(day: string): string {
  return WEEKDAY.format(new Date(toUtc(day)))
}

/** "October 2026" */
export function monthLabel(day: string): string {
  return MONTH.format(new Date(toUtc(day)))
}

/** "Wed 28 Oct" */
export function dayLabel(day: string): string {
  return `${weekday(day)} ${shortDate(day)}`
}

/** "Today", "Tomorrow", else "Wed 28 Oct" */
export function relativeDay(day: string, today: string): string {
  const gap = daysBetween(today, day)
  if (gap === 0) return "Today"
  if (gap === 1) return "Tomorrow"
  if (gap === -1) return "Yesterday"
  return dayLabel(day)
}

/** "28 Oct 2026, 3:10 pm" in IST for a naive-UTC server timestamp. */
export function istDateTime(value?: string | null): string {
  if (!value) return "—"
  const stamp = /[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`
  const date = new Date(stamp)
  if (Number.isNaN(date.getTime())) return "—"
  return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }).format(date).replace(/,(?=\s\d{4})/, "")
}

export function istDay(value?: string | null): string | null {
  if (!value) return null
  const stamp = /[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`
  const date = new Date(stamp)
  if (Number.isNaN(date.getTime())) return null
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date)
  const part = (type: string) => parts.find((row) => row.type === type)?.value || ""
  return `${part("year")}-${part("month")}-${part("day")}`
}

const UNIT_WORDS: Record<string, string> = { KG: "kg", PCS: "pcs", L: "L", MT: "t" }

export function unitWord(uom?: string | null): string {
  return UNIT_WORDS[String(uom || "").toUpperCase()] || String(uom || "").toLowerCase()
}

/** "1,234.5 kg" — pieces never get decimals. */
export function qty(value: number | null | undefined, uom?: string | null, options: { signed?: boolean } = {}): string {
  const number = Number(value || 0)
  const pieces = String(uom || "").toUpperCase() === "PCS"
  const text = Math.abs(number).toLocaleString("en-IN", { maximumFractionDigits: pieces ? 0 : number !== 0 && Math.abs(number) < 10 ? 2 : 1 })
  const sign = number < 0 ? "−" : options.signed && number > 0 ? "+" : ""
  return `${sign}${text}${uom ? ` ${unitWord(uom)}` : ""}`
}

/** Dense cells: en-IN whole numbers from 100 up ("1,812", "12,400"), one decimal below ("7.5"). */
export function compact(value: number): string {
  const abs = Math.abs(value)
  const sign = value < 0 ? "−" : ""
  return `${sign}${abs.toLocaleString("en-IN", { maximumFractionDigits: abs >= 100 ? 0 : abs > 0 && abs < 10 ? 2 : 1 })}`
}

/** Dense cells still carry the unit: "1,512 kg", "200 pcs". */
export function compactQty(value: number, uom?: string | null): string {
  return `${compact(value)} ${unitWord(uom)}`.trim()
}

/** Each unit on its own line-able part: ["2,415 kg", "130 pcs"] (never one string that wraps mid-total). */
export function perUnitParts(totals: Record<string, number>): string[] {
  return Object.entries(totals).filter(([, value]) => Math.abs(value) > 0.0005).map(([uom, value]) => qty(value, uom))
}

/** Totals per unit, never adding pieces into kilograms: "1,240 kg · 300 pcs". */
export function perUnit(totals: Record<string, number>): string {
  const parts = Object.entries(totals).filter(([, value]) => Math.abs(value) > 0.0005).map(([uom, value]) => qty(value, uom))
  return parts.length ? parts.join(" · ") : "0"
}

/** "owner2.e2e@hariom.com" → "Owner2 E2e"; plain names stay as they are. */
export function personName(actor?: string | null): string {
  if (!actor) return "—"
  const known = knownPersonName(actor) // the people-directory name once known (names, not logins)
  if (known) return known
  const local = actor.includes("@") ? actor.split("@")[0] : actor
  return local.split(/[._\-\s]+/).filter(Boolean).map((part) => part[0].toUpperCase() + part.slice(1)).join(" ")
}

export const CLASS_TABS: Array<{ id: MaterialClass | "ALL"; label: string }> = [
  { id: "PAPER", label: "Paper" },
  { id: "CHEMICAL", label: "Chemicals" },
  { id: "PACKING", label: "Packing" },
  { id: "ALL", label: "All" },
]

export const CLASS_LABEL: Record<string, string> = { PAPER: "Paper", CHEMICAL: "Chemicals", PACKING: "Packing" }

export type ChipTone = "proposed" | "approved" | "onpo" | "sent" | "confirmed" | "received" | "overdue" | "rejected"

/** State shown on a chip: received wins, then overdue, then the arrival's own state. */
export function chipState(arrival: Pick<Arrival, "state" | "overdue" | "open_qty">): { tone: ChipTone; label: string } {
  if (arrival.state === "RECEIVED") return { tone: "received", label: "Received" }
  // The Owner rejected the PO: nothing is coming until the desk revises it (never counted as cover).
  if (arrival.state === "REJECTED") return { tone: "rejected", label: "PO rejected" }
  if (arrival.overdue && arrival.state !== "PROPOSED") return { tone: "overdue", label: "Overdue" }
  const map: Record<ArrivalState, { tone: ChipTone; label: string }> = {
    PROPOSED: { tone: "proposed", label: arrival.overdue ? "Proposed · late" : "Proposed" },
    APPROVED: { tone: "approved", label: "Approved" },
    ON_PO: { tone: "onpo", label: "On PO" },
    SENT: { tone: "sent", label: "Sent" },
    CONFIRMED: { tone: "confirmed", label: "Confirmed" },
    RECEIVED: { tone: "received", label: "Received" },
    CANCELLED: { tone: "proposed", label: "Cancelled" },
    REJECTED: { tone: "rejected", label: "PO rejected" },
  }
  return map[arrival.state] || { tone: "onpo", label: arrival.state }
}

export const CHIP_CLASSES: Record<ChipTone, string> = {
  proposed: "border-dashed border-foreground/30 bg-card text-foreground/80",
  approved: "border-signal-violet-line bg-signal-violet-soft text-signal-violet-ink",
  onpo: "border-signal-teal-line bg-signal-teal-soft text-signal-teal-ink",
  sent: "border-signal-blue-line bg-signal-blue-soft text-signal-blue-ink",
  confirmed: "border-signal-indigo-line bg-signal-indigo-soft text-signal-indigo-ink",
  received: "border-signal-emerald-line bg-signal-emerald-soft text-signal-emerald-ink",
  overdue: "border-signal-rose-line bg-signal-rose-soft text-signal-rose-ink",
  rejected: "border-dashed border-signal-rose-line bg-card text-signal-rose-ink line-through decoration-signal-rose-ink/40",
}

export const LEGEND: Array<{ tone: ChipTone; label: string; meaning: string }> = [
  { tone: "proposed", label: "Proposed", meaning: "Suggested by the desk; not counted until the Owner approves" },
  { tone: "approved", label: "Approved", meaning: "Owner approved; counted as arriving" },
  { tone: "onpo", label: "On PO", meaning: "On a purchase order not yet sent" },
  { tone: "sent", label: "Sent", meaning: "PO sent to the vendor" },
  { tone: "confirmed", label: "Confirmed", meaning: "Vendor confirmed the date" },
  { tone: "received", label: "Received", meaning: "GRN done; now in stock or QC" },
  { tone: "overdue", label: "Overdue", meaning: "Date passed, not received; counted on today" },
  { tone: "rejected", label: "PO rejected", meaning: "The Owner sent the PO back; not counted until the desk revises it and he approves it" },
]

export type CoverWord = { tone: "short" | "low" | "ok"; text: string; detail: string }

/** One line about how long stock lasts: "Short from 11 Nov" / "Below minimum from 4 Nov" / "Covered for 8 weeks". */
export function coverWord(material: Pick<CalendarMaterial, "first_short" | "days_of_cover" | "uom">, weeks: number, today: string): CoverWord {
  const short = material.first_short
  if (!short) return { tone: "ok", text: `Covered for ${weeks} weeks`, detail: "Stock and counted arrivals meet every need in the window" }
  const when = short.date === today ? "today" : shortDate(short.date)
  if (short.kind === "BELOW_MIN") return { tone: "low", text: `Below minimum ${short.date === today ? "today" : `from ${when}`}`, detail: `${qty(short.qty, material.uom)} more keeps the minimum stock` }
  return { tone: "short", text: short.date === today ? "Short today" : `Short from ${when}`, detail: `${qty(short.qty, material.uom)} short on that day` }
}

/** The same line for ONE day of the day sheet: a day that is covered never says "Short today" (checker r4). */
export function dayCoverWord(material: Pick<CalendarMaterial, "first_short" | "balance" | "min_stock" | "uom">, index: number, day: string, today: string): CoverWord {
  const balance = Number(material.balance[index] ?? 0)
  const when = day === today ? "today" : "this day"
  if (balance < -0.0005) return { tone: "short", text: `Short ${qty(-balance, material.uom)} ${when}`, detail: `Balance at day end ${qty(balance, material.uom)}` }
  const minimum = Number(material.min_stock || 0)
  if (minimum > 0 && balance < minimum - 0.0005) return { tone: "low", text: `Below minimum ${when}`, detail: `${qty(minimum - balance, material.uom)} under the minimum stock at day end` }
  const short = material.first_short
  const whenShort = short ? (short.date === today ? "today" : `${short.date < day ? "on" : "from"} ${shortDate(short.date)}`) : ""
  const other = short && short.date !== day ? ` · ${short.kind === "BELOW_MIN" ? "below minimum" : "short"} ${whenShort}` : ""
  return { tone: "ok", text: `Covered ${when}${other}`, detail: `Balance at day end ${qty(balance, material.uom)}` }
}

/** How many days stock and counted arrivals last: "13 days of cover", "Covers all 8 weeks".
 *  With nothing needed before the first short day it says "No need until 11 Nov": "12 days of cover"
 *  next to 0 kg usable stock misleads (checker 2026-10-30, Kraft 350 GSM). */
export function coverDays(material: Pick<CalendarMaterial, "first_short" | "days_of_cover"> & { need?: number[] }, weeks: number): string {
  const short = material.first_short
  if (!short) return `Covers all ${weeks} weeks`
  const days = Math.max(0, Number(material.days_of_cover ?? 0))
  if (days > 0 && Array.isArray(material.need) && material.need.slice(0, days).every((value) => !(Number(value) > 0.0005))) return `No need until ${shortDate(short.date)}`
  if (short.kind === "BELOW_MIN") return days === 0 ? "Below minimum now" : `${days} day${days === 1 ? "" : "s"} above minimum`
  return days === 0 ? "No cover left" : `${days} day${days === 1 ? "" : "s"} of cover`
}

/** Rate as the Owner sees it before approving: "₹44.50 / kg". */
export function rateText(rate: number | null | undefined, uom?: string | null): string {
  if (!rate) return "Rate needed"
  return `₹${Number(rate).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} / ${String(uom || "").toUpperCase() === "PCS" ? "piece" : unitWord(uom)}`
}

export function rupees(value: number | null | undefined): string {
  return `₹${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`
}

export const CHANNEL_LABEL: Record<string, string> = { WHATSAPP: "WhatsApp", EMAIL: "email", PDF: "PDF download", PRINT: "print" }

export function searchMatch(material: Pick<CalendarMaterial, "item_code" | "item_name">, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return `${material.item_code} ${material.item_name}`.toLowerCase().includes(needle)
}
