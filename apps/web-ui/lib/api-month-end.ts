/**
 * Month-end close (client 2026-10-28, spec 2.1 / 2.5 / 2.6): one place per plant and month to check the
 * spec against what the store issued to the floor against what the approved month-end count says was
 * used, write a note on items outside their limit, and (Owner) close or re-open the month.
 * Every quantity is in the item's own stock unit; totals are per unit.
 */
import { api } from "./api"
import { describeApiError } from "./api-error"
import { personLabel } from "./people"

export type GapStatus = "OK" | "OVER" | "UNDER" | "NOT_KNOWN"
export type MonthState = "RUNNING" | "OPEN" | "CLOSED"
export type StepState = "done" | "now" | "todo"

export type MonthEndNote = { note: string; noted_by?: string | null; noted_at?: string | null }

export type MonthEndItem = {
  item_id: string | null
  item_code: string
  item_name: string
  item_type: string | null
  material_type: string
  material_label: string
  uom: string
  unit_label: string
  opening: number
  received: number
  opening_loads: number
  sent_back: number
  issued: number
  corrections: number
  count_variance: number
  closing: number
  actual_used: number | null
  book_used: number
  identity_ok: boolean
  spec: number
  normal_wastage_pct: number
  allowed_gap_pct: number
  min_gap: number
  expected: number
  wastage_allowance: number
  floor_gap: number
  store_gap: number | null
  total_gap: number | null
  allowed_gap: number
  status: GapStatus
  floor_status: GapStatus
  has_use: boolean
  job_cards: number
  posted_after_close: number
  note: MonthEndNote | null
  needs_note: boolean
  /** Spec posted this month in another unit than the stock item counts in (so it is not compared). */
  spec_unlinked?: { spec: number; unit_label: string; job_cards: number } | null
  /** Why the store book of this item does not add up, in words (null when it does). */
  book_problem?: string | null
  /** The closing differs from what the approved month-end count certified (entries posted after it). */
  changed_since_count?: { counted: number; closing: number } | null
}

/** Items the floor used more / less for than spec + wastage, beyond their own limit (never netted). */
export type FloorSplit = {
  floor_over_items?: number
  floor_over?: number
  floor_under_items?: number
  floor_under?: number
}

export type MonthEndUnitTotal = FloorSplit & {
  uom: string
  unit_label: string
  items: number
  items_with_use: number
  status_counts: Record<GapStatus, number>
  opening: number
  received: number
  opening_loads: number
  sent_back: number
  issued: number
  corrections: number
  /** Count differences inside ``corrections``; missing on months frozen before it was kept. */
  count_variance?: number
  closing: number
  actual_used: number | null
  spec: number
  expected: number
  floor_gap: number
  store_gap: number | null
  total_gap: number | null
}

export type MonthEndUnlinked = {
  /** NO_STOCK_ITEM: no stock item has the code; UNIT_DIFFERS: the spec is in another unit than the item. */
  link?: "NO_STOCK_ITEM" | "UNIT_DIFFERS"
  item_code: string
  item_name?: string | null
  spec: number
  uom: string
  unit_label: string
  job_cards: number
  kind: string
  reason: string
  fix_label: string
  fix_href: string
}

export type MonthEndStep = {
  key: "month_ended" | "count" | "book" | "notes" | "earlier" | string
  label: string
  state: StepState
  detail: string
  action_label?: string | null
  action_href?: string | null
  /** A done step that still needs the Owner's eye (e.g. closings changed after the count). */
  warning?: string | null
  /** The step cannot be done from here right now (the detail says why). */
  blocked?: boolean
}

export type CountChange = { item_code: string; item_name: string; unit_label: string; counted: number; closing: number }

export type MonthEndLimit = {
  material_type: string
  label: string
  normal_wastage_pct: number
  allowed_gap_pct: number
  min_gap: number
  source?: "PLANT" | "DEFAULT"
  updated_by?: string | null
  updated_at?: string | null
  unit_hint?: string
  units_in_use?: string[]
}

export type MonthEndHistoryEvent = { event: "CLOSED" | "REOPENED"; actor?: string | null; reason?: string | null; at?: string | null; details?: Record<string, any> }

export type MonthEndCount = {
  id?: string | null
  count_no?: string | null
  status?: string | null
  approved: boolean
  approved_by?: string | null
  approved_at?: string | null
}

export type MonthEndOverview = {
  plant_id: string
  month: string
  month_label: string
  month_word: string
  period_start: string
  period_end: string
  fy: string
  is_fy_close: boolean
  close_title: string
  state: MonthState
  frozen: boolean
  changed_after_close: string[] | null
  figures_available: boolean
  opening_source?: string | null
  count: MonthEndCount | null
  actual_known: boolean
  running: boolean
  items: MonthEndItem[]
  unlinked: MonthEndUnlinked[]
  units: MonthEndUnitTotal[]
  limits: MonthEndLimit[]
  /** Items whose store book does not add up (the month cannot close until fixed). */
  book_problems?: Array<{ item_code: string; item_name: string; unit_label: string; closing: number | null; problem: string }>
  /** Closings that changed after the month-end count was approved; null when not checked. */
  changed_since_count?: CountChange[] | null
  checklist: MonthEndStep[]
  progress: { done: number; total: number }
  next: { kind: string; title: string; detail: string; action_label?: string | null; action_href?: string | null; waiting_for?: string | null }
  close: {
    status: string
    closed_by?: string | null
    closed_at?: string | null
    close_note?: string | null
    version: number
    snapshot_at?: string | null
    reopened_by?: string | null
    reopened_at?: string | null
    reopen_reason?: string | null
  } | null
  history: MonthEndHistoryEvent[]
  earlier_open_months: string[]
  later_closed_months: string[]
  reopened_months?: string[]
  can: { close: boolean; reopen: boolean; note: boolean; edit_limits: boolean; is_owner: boolean }
}

export type MonthEndMonthRow = {
  month: string
  month_label: string
  fy: string
  is_fy_close: boolean
  status: MonthState
  has_activity: boolean
  closed_by?: string | null
  closed_at?: string | null
  close_note?: string | null
  version?: number | null
  reopened_by?: string | null
  reopened_at?: string | null
  reopen_reason?: string | null
  frozen: boolean
  summary: { items_with_use: number; over: number; under: number; explained: number; units: MonthEndUnitTotal[] } | null
  history: MonthEndHistoryEvent[]
}

export type MonthEndMonths = {
  plant_id: string
  current_month: string
  default_month: string
  first_month: string
  months: MonthEndMonthRow[]
}

export type MonthEndYearMonth = {
  month: string
  month_label: string
  short_label: string
  status: MonthState | "FUTURE"
  has_activity: boolean
  closed_by?: string | null
  closed_at?: string | null
  units: MonthEndUnitTotal[]
  figures_available: boolean
  actual_known: boolean
  needs_note: number
}

export type MonthEndYearTotal = FloorSplit & {
  uom: string
  unit_label: string
  opening: number | null
  closing: number | null
  received: number
  opening_loads: number
  sent_back: number
  issued: number
  corrections: number
  spec: number
  expected: number
  actual_used: number
  floor_gap: number
  months_known: number
  months: number
}

export type MonthEndYear = {
  plant_id: string
  fy: string
  period_start: string
  period_end: string
  previous_fy: string
  next_fy: string | null
  months: MonthEndYearMonth[]
  totals: MonthEndYearTotal[]
  closed_months: number
  complete: boolean
  march_closed: boolean
  opening_label?: string
  closing_label: string
}

export type SourceRow = Record<string, any>

export type MonthEndSources = {
  month: string
  item_code: string
  item_id: string | null
  spec: {
    /** spec/unit are in the stock item's unit when it converts (kg → litre); posted_* is what the card posted. */
    rows: Array<{ job_card_id: string; job_card_no?: string | null; product_code?: string | null; stage?: string | null; good_qty: number; spec: number; unit: string; unit_label?: string | null; posted_spec?: number; posted_unit?: string; posted_on?: string | null; posted_after_close?: string | null }>
    total: number
    total_unit?: string | null
    total_unit_label?: string | null
    totals?: Array<{ unit: string; unit_label: string; qty: number }>
    /** The spec is in another unit than the stock item, so the page cannot compare it (spec not linked). */
    unit_differs?: boolean
    stock_unit_label?: string | null
    job_cards: number
  }
  store: { available: boolean; data: Record<string, any> | SourceRow[] | null }
  ledger_href: string | null
  note: MonthEndNote | null
}

export type UsageLimitsResponse = {
  scope: "plant" | "all"
  plants: Array<{ plant_id: string; limits: MonthEndLimit[] }>
  defaults: MonthEndLimit[]
  can_edit: boolean
}

const onPlant = (plantId?: string | null) => (plantId && plantId !== "ALL" ? { headers: { "X-Plant-ID": plantId } } : undefined)

export const monthEndApi = {
  months: (plantId: string) => api.get<MonthEndMonths>("/api/production/month-end/months", onPlant(plantId)),
  overview: (month: string, plantId: string) =>
    api.get<MonthEndOverview>("/api/production/month-end/overview", { ...onPlant(plantId), params: { month } }),
  year: (fy: string | undefined, plantId: string) =>
    api.get<MonthEndYear>("/api/production/month-end/year", { ...onPlant(plantId), params: fy ? { fy } : {} }),
  sources: (month: string, itemCode: string, itemId: string | null | undefined, plantId: string) =>
    api.get<MonthEndSources>("/api/production/month-end/sources", {
      ...onPlant(plantId),
      params: { month, item_code: itemCode, ...(itemId ? { item_id: itemId } : {}) },
    }),
  saveNote: (body: { month: string; item_code: string; item_id?: string | null; item_name?: string | null; note: string }, plantId: string) =>
    api.put("/api/production/month-end/notes", body, onPlant(plantId)),
  close: (body: { month: string; note?: string | null; accept_count_changes?: boolean }, plantId: string) =>
    api.post<MonthEndOverview>("/api/production/month-end/close", body, onPlant(plantId)),
  reopen: (body: { month: string; reason: string }, plantId: string) =>
    api.post<MonthEndOverview>("/api/production/month-end/reopen", body, onPlant(plantId)),
  limits: (plantId: string) => api.get<UsageLimitsResponse>("/api/production/month-end/limits", onPlant(plantId)),
  saveLimits: (limits: Array<Pick<MonthEndLimit, "material_type" | "normal_wastage_pct" | "allowed_gap_pct" | "min_gap">>, plantId: string) =>
    api.put<{ plant_id: string; limits: MonthEndLimit[] }>("/api/production/month-end/limits", { limits }, onPlant(plantId)),
}

// ── words and numbers ────────────────────────────────────────────────────────

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** "1,234.5 kg" — en-IN, up to 3 decimals for small numbers, 1 for large ones; a real minus sign. */
export function qty(value: number | null | undefined, unit?: string, digits?: number): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—"
  const numeric = Number(value)
  // One decimal from 10 up (every kg figure on a page reads alike), more only for small figures.
  const max = digits ?? (Math.abs(numeric) >= 10 ? 1 : Math.abs(numeric) >= 1 ? 2 : 3)
  const text = Math.abs(numeric).toLocaleString("en-IN", { maximumFractionDigits: max })
  const signed = numeric < 0 && text !== "0" ? `−${text}` : text
  return unit ? `${signed} ${unit}` : signed
}

/** A signed change with its sign always shown: "+25 pcs", "−5 kg", "0 kg". */
export function signedQty(value: number | null | undefined, unit?: string): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—"
  const numeric = Number(value)
  if (Math.abs(numeric) < 0.0005) return qty(0, unit)
  return `${numeric > 0 ? "+" : "−"}${qty(Math.abs(numeric), unit)}`
}

/**
 * What the store side changed, in words. ``corrections`` holds every stock change that is not a receipt,
 * return or issue (spec 2.1); ``countVariance`` is the part found by counts. A manual correction is never
 * called a count. ``countVariance`` undefined (months frozen before it was kept) reads as both together.
 */
export function storeChangeWords(corrections: number | null | undefined, countVariance: number | null | undefined, unit: string): {
  sentence: string
  short: string
} {
  const total = Number(corrections || 0)
  if (Math.abs(total) < 0.0005) return { sentence: "store count matches the books", short: "Matches the books" }
  const amount = qty(Math.abs(total), unit)
  const direction = total < 0 ? "short of" : "more than"
  if (countVariance === undefined || countVariance === null) {
    return { sentence: `count and corrections are ${amount} ${direction} the books`, short: `Count and corrections ${signedQty(total, unit)}` }
  }
  const count = Number(countVariance || 0)
  const other = total - count
  if (Math.abs(other) < 0.0005) {
    return { sentence: `store count is ${amount} ${direction} the books`, short: `Count ${signedQty(count, unit)}` }
  }
  if (Math.abs(count) < 0.0005) {
    return {
      sentence: total < 0 ? `corrections took ${amount} off the books` : `corrections added ${amount} to the books`,
      short: `Corrections ${signedQty(other, unit)}`,
    }
  }
  return {
    sentence: `count and corrections are ${amount} ${direction} the books (count ${signedQty(count, unit)}, corrections ${signedQty(other, unit)})`,
    short: `Count ${signedQty(count, unit)} · corrections ${signedQty(other, unit)}`,
  }
}

const CODE_WORDS: Record<string, string> = {
  PHYSICAL_COUNT_VARIANCE: "Count difference",
  COUNT_SHORT: "Count short",
  COUNT_EXTRA: "Count extra",
  DAMAGED_IN_STORE: "Damaged in store",
  WRONG_GRN_WEIGHT: "Wrong GRN weight",
  LABEL_LOST_FOUND: "Label lost / found",
  OTHER: "Other",
  FLOOR_ISSUE: "Issued to the floor",
  MATERIAL_ISSUE: "Issued to the floor",
  QC_REJECT: "Rejected at incoming QC",
  SUPPLIER_RETURN: "Returned to supplier",
  OPENING_LOAD: "Opening load",
  CUSTOMER_COMPLAINT_SCRAP: "Scrapped after a complaint",
  QC: "Final QC",
}

/** A stored code ("DAMAGED_IN_STORE") in plain words ("Damaged in store"); free text is kept as typed. */
export function plainCode(value: unknown): string {
  const text = String(value ?? "").trim()
  if (!text) return ""
  if (CODE_WORDS[text]) return CODE_WORDS[text]
  // Only SNAKE_CASE codes and single capitalised words ("WINDER") are rewritten; document and lot
  // numbers ("VAR-20260930-001") stay as printed.
  if (!/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$|^[A-Z]{3,}$/.test(text)) return text
  const words = text.replace(/_+/g, " ").toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** "27 Oct 2026" from an ISO date or a naive-UTC server timestamp, shown in IST. */
export function dayText(value: string | null | undefined): string {
  if (!value) return ""
  const text = String(value)
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const [y, m, d] = text.split("-").map(Number)
    return `${d} ${MONTHS[m - 1]} ${y}`
  }
  const stamp = new Date(/(?:Z|[+-]\d{2}:\d{2})$/i.test(text) ? text : `${text}Z`)
  if (Number.isNaN(stamp.getTime())) return text
  return stamp.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" })
}

/** "27 Oct 2026, 4:05 pm" in IST. */
export function dayTimeText(value: string | null | undefined): string {
  if (!value) return ""
  const text = String(value)
  const stamp = new Date(/(?:Z|[+-]\d{2}:\d{2})$/i.test(text) ? text : `${text}Z`)
  if (Number.isNaN(stamp.getTime())) return text
  return stamp.toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" })
}

/** A login in plain words: the part before @ of an e-mail address. */
export function personText(value: string | null | undefined): string {
  return personLabel(value, "someone") // the people-directory name once known (names, not logins)
}

/**
 * A load or save error of the month-end pages in plain words. A request that timed out or never reached
 * the server has no body, and a gateway error page is HTML: neither is shown as it is (checker r2 saw
 * "timeout of 30000ms exceeded" on a slow load). Other errors keep the server's own sentence.
 */
export function monthEndErrorText(error: any, fallback = "Try again in a minute."): string {
  const response = error?.response
  if (!response) {
    const code = String(error?.code || "")
    const message = String(error?.message || "")
    if (code === "ECONNABORTED" || code === "ETIMEDOUT" || /timeout/i.test(message)) return "The server is slow right now. Try again in a minute."
    if (code === "ERR_NETWORK" || /network/i.test(message)) return "The server could not be reached. Check the connection and try again."
    return fallback
  }
  const data = response.data
  if ((typeof data === "string" && /^\s*</.test(data)) || (response.status >= 502 && response.status <= 504 && !(data && typeof data === "object"))) {
    return "The server is slow right now. Try again in a minute."
  }
  return describeApiError(error, fallback)
}

/** "2026-10" → "October 2026". */
export function monthText(key: string | null | undefined): string {
  const match = /^(\d{4})-(\d{2})/.exec(String(key || ""))
  if (!match) return ""
  const long = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
  return `${long[Number(match[2]) - 1]} ${match[1]}`
}

/** The month before / after "YYYY-MM", without Date maths across time zones. */
export function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number)
  const index = y * 12 + (m - 1) + delta
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`
}

/** "YYYY-MM" of today in IST. */
export function istMonthKey(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit" }).formatToParts(now)
  const year = parts.find((part) => part.type === "year")?.value
  const month = parts.find((part) => part.type === "month")?.value
  return `${year}-${month}`
}

/** "more" / "less" sentence for a signed gap: "6.94 kg more than the spec allows". */
export function gapWords(gap: number | null | undefined, unit: string): { amount: string; direction: "more" | "less" | "same" } {
  const value = Number(gap || 0)
  if (Math.abs(value) < 0.0005) return { amount: qty(0, unit), direction: "same" }
  return { amount: qty(Math.abs(value), unit), direction: value > 0 ? "more" : "less" }
}

/**
 * A unit's floor use against spec + wastage in words. The signed unit total nets items out (one item
 * 200 pcs over and another 200 pcs under add up to 0), so items outside their own limit are always named
 * and "exactly" is said only when nothing is outside.
 */
export function unitFloorWords(unit: FloorSplit & { floor_gap: number | null | undefined }, unitLabel: string, running = false): { sentence: string; short: string; outside: boolean } {
  const overItems = Number(unit.floor_over_items || 0)
  const underItems = Number(unit.floor_under_items || 0)
  const net = gapWords(unit.floor_gap, unitLabel)
  const netText = net.direction === "same" ? `net ${net.amount}` : `net ${net.amount} ${net.direction}`
  // The net covers every material of the unit, not only the ones outside their limit: say so.
  const allNetText = net.direction === "same" ? `net for all materials ${net.amount}` : `net for all materials ${net.amount} ${net.direction}`
  const lead = running ? "So far, " : ""
  if (overItems || underItems) {
    const items = (count: number) => (count === 1 ? "1 item" : `${count} items`)
    const parts: string[] = []
    const shortParts: string[] = []
    if (overItems) {
      parts.push(`${items(overItems)} took ${qty(unit.floor_over, unitLabel)} more`)
      shortParts.push(`${items(overItems)} more (${signedQty(unit.floor_over, unitLabel)})`)
    }
    if (underItems) {
      parts.push(`${items(underItems)} took ${qty(unit.floor_under, unitLabel)} less`)
      shortParts.push(`${items(underItems)} less (${signedQty(-Number(unit.floor_under || 0), unitLabel)})`)
    }
    return {
      sentence: `${running ? "So far on the floor" : "On the floor"}, ${parts.join(" and ")} than spec + wastage, outside ${overItems + underItems === 1 ? "its" : "their"} limit (${allNetText})`,
      short: `${shortParts.join(", ")} · ${netText}`,
      outside: true,
    }
  }
  if (net.direction === "same") {
    return { sentence: `${lead}${running ? "the" : "The"} floor took exactly the spec + wastage`, short: "Exactly", outside: false }
  }
  return {
    sentence: `${lead}${running ? "the" : "The"} floor took ${net.amount} ${net.direction} than spec + wastage, every item within its limit`,
    short: `${net.amount} ${net.direction} · within limits`,
    outside: false,
  }
}

/** An example note in the item's own words and unit (packing in sheets / boxes, never "kg cut off"). */
export function notePlaceholder(item: Pick<MonthEndItem, "status" | "material_type" | "unit_label">): string {
  const more = item.status === "OVER"
  const unit = item.unit_label || "kg"
  const examples: Record<string, [string, string]> = {
    RAW_PAPER: [`reel 2 had a damaged outer layer, 6 ${unit} cut off`, "trial run used a lighter paper"],
    ADHESIVE: [`a drum skinned over, about 4 ${unit} thrown away`, "the new gum spreads thinner"],
    PARCHMENT: [`a roll was creased, 3 ${unit} cut off`, "fewer tubes needed the lining"],
    PACKAGING: [`20 ${unit} torn in the rain`, `bundles were packed with fewer ${unit} each`],
    OTHER: [`some ${unit} were spoilt in the store`, `less ${unit} were needed this month`],
  }
  const [over, under] = examples[item.material_type] || examples.OTHER
  return more ? `Why more? e.g. ${over}` : `Why less? e.g. ${under}`
}

export const STATUS_WORDS: Record<GapStatus, string> = {
  OK: "Within limit",
  OVER: "Used more",
  UNDER: "Used less",
  NOT_KNOWN: "Waiting for count",
}
