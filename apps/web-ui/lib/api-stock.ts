import { api } from "@/lib/api"

import { peopleInText } from "./people"
import { dayText, errorText as plainErrorText, isWholeUnit, qtyText } from "./stock-format"
import type { RackStatus, Tone, UnitTotal, Uom } from "./stock-format"

export type { RackStatus, Tone, UnitTotal, Uom } from "./stock-format"

/**
 * Stock stream API (client 2026-10-28): counts by rack, locations, scan moves, corrections and the stock
 * book (month figures). Every call goes through the BFF under /api/inventory/…; the inventory service
 * checks roles (Owner-only approvals) and closed months itself.
 */


export type LocationBrief = { id: string; code: string; name: string; purpose: string | null; active: boolean; is_receiving_default: boolean }
export type StockSummary = { reels: number; lots: number; held: number; totals: UnitTotal[] }
export type LocationRow = LocationBrief & {
  plant_id: string
  warehouse: string
  zone: string | null
  bin: string | null
  updated_by: string | null
  updated_at: string | null
  created_at: string
  stock: StockSummary
  last_counted_at: string | null
  /** False while the count that last finished this rack is still with the store or the Owner. */
  last_count_approved?: boolean
}
export type LocationRights = { manage: boolean; move: boolean; correct: boolean; put_away_all: boolean; issue: boolean; inspect: boolean }
export type LocationsOverview = {
  plant_id: string; items: LocationRow[]; unassigned: StockSummary; unassigned_materials: StockSummary; unassigned_finished_lots: number
  open_count_total: number; can: LocationRights
}
export type LotRow = {
  entity_type: "REEL" | "BATCH"
  id: string
  code: string
  item_id: string
  item_code: string | null
  item_name: string | null
  item_type: string
  uom: Uom
  qty: number
  stock_status: string
  qc_word: string
  held: boolean
  physical_form: string | null
  location_id: string | null
  location_code: string | null
  location_name: string | null
  in_since: string | null
  /** When it came to the place it is now (last move there, else received): naive UTC. */
  here_since?: string | null
  created_at?: string | null
  unit_cost: number
}
export type OpenCount = { id: string; count_no: string; kind: "SPOT" | "MONTH_END"; status: string; month: string | null; rack_status: string; counted_by: string | null }
export type LocationDetail = {
  location: LocationRow
  stock: { reels: LotRow[]; lots: LotRow[] }
  totals: UnitTotal[]
  open_counts: OpenCount[]
  last_counted_at: string | null
  last_count_approved?: boolean
  can: LocationRights
}
export type LocationInput = { code?: string; name?: string | null; warehouse?: string; zone?: string | null; bin?: string | null; purpose?: string; active?: boolean; is_receiving_default?: boolean }

export type MoveResult = { moved: boolean; already_here: boolean; client_ref: string; lot: LotRow; from: LocationBrief | null; to: LocationBrief | null; held: boolean; message: string }

export type CountKind = "SPOT" | "MONTH_END"
export type CountStatus = "DRAFT" | "SUBMITTED" | "APPROVED" | "CERTIFIED" | "CANCELLED"
export type CountHeader = {
  id: string
  plant_id: string
  count_no: string
  kind: CountKind
  kind_word: string
  month: string | null
  month_label: string | null
  status: CountStatus
  status_word: string
  created_by: string
  created_at: string
  counted_by: string | null
  submitted_by: string | null
  submitted_at: string | null
  submit_note: string | null
  approved_by: string | null
  approved_at: string | null
  approve_note: string | null
  sent_back_by: string | null
  sent_back_at: string | null
  sent_back_note: string | null
  cancelled_by: string | null
  cancelled_at: string | null
  cancel_note: string | null
  scope_item_ids: string[]
  racks_total: number
  racks_done: number
  notes: string | null
}
export type CountListRow = CountHeader & { racks_counting: number; lines: number; found: number; missing: number; extra: number; issued_found: number; wrong_place: number; counters: string[] }
/** The month-end card: the month the store should count now (``can_start``), or why it cannot start yet. */
export type MonthEndState = { month: string; month_label: string; closed: boolean; count: CountListRow | null; can_start: boolean; opens_on: string | null; note: string | null }
export type CountList = { items: CountListRow[]; month_end: MonthEndState[]; today: string }
export type RackProgress = { found: number; wrong_place: number; extra: number; issued_found: number; missing: number; used: number; arrived: number; moved?: number; to_find: number; expected: number; scanned: number }
export type RackView = {
  key: string
  id: string
  bucket: "LOCATION" | "UNASSIGNED"
  location: LocationBrief | null
  label: string
  name: string
  status: RackStatus
  counted_by: string | null
  started_at: string | null
  done_by: string | null
  done_at: string | null
  recount_note: string | null
  progress: RackProgress
}
export type EntryStatus = "FOUND" | "WRONG_PLACE" | "EXTRA" | "ISSUED_FOUND" | "MISSING" | "USED" | "ARRIVED" | "MOVED"
export type CountEntry = {
  id: string
  rack: string
  entity_type: "REEL" | "BATCH" | "LOOSE"
  entity_id: string | null
  code: string | null
  item_id: string
  item_code: string | null
  item_name: string | null
  item_type: string
  uom: Uom
  stock_status: string | null
  status: EntryStatus
  /** Had no location; filed on the rack where it was found when the count is approved. */
  filed_here: boolean
  result_word: string
  tone: Tone
  expected_qty: number
  counted_qty: number | null
  variance_qty: number
  value: number | null  // null = no rate known for a line that changes stock
  value_known?: boolean
  unit_cost: number
  location_code: string | null
  location_name: string | null
  expected_location_code: string | null
  movement_flag: string | null
  movement_word: string | null
  decision: "LEAVE_AS_USED" | "ADD_ON_QC_HOLD" | null
  decided_by: string | null
  note: string | null
  counted_by: string | null
  counted_at: string | null
  auto: boolean
  adjustment_line_id: string | null
  created_lot_id: string | null
  created_lot_type: "REEL" | "BATCH" | null
  created_lot_code: string | null
}
export type CountRights = { count: boolean; submit: boolean; approve: boolean; send_back: boolean; decide: boolean; cancel: boolean; print_labels?: boolean }
export type CountSummary = {
  found: number; missing: number; extra: number; wrong_place: number; issued_found: number; loose: number; used: number; arrived: number; moved?: number
  qty_different: number; filed: number; lines: number
  gain_value: number; loss_value: number; net_value: number; undecided: number
  by_unit: Array<{ uom: Uom; gain: number; loss: number; net: number }>
  /** Lines that change stock but have no rate; the rupee figures leave them out. */
  unpriced_lines?: number
  unpriced_by_unit?: Array<{ uom: Uom; lines: number; gain: number; loss: number }>
}
export type CountVoucher = { id: string; voucher_no: string; status: string; effective_date: string; line_count: number }
/** Stock entered after an approved month-end count but dated into the month it counted (flag, not a block). */
export type ChangedAfterCount = { item_id: string; item_code: string | null; item_name: string | null; uom: Uom | null; qty: number; rows: number; docs: string[]; first_day: string | null }
export type CountDetail = CountHeader & {
  racks: RackView[]
  summary: CountSummary
  counters: string[]
  voucher: CountVoucher | null
  vouchers: CountVoucher[]
  can: CountRights
  entries: CountEntry[]
  existing?: boolean
  changed_after_count?: ChangedAfterCount[]
  /** Why the Owner cannot approve this count now (a later month was closed after it was started). */
  approve_refusal?: string | null
}
export type ExpectedLot = LotRow & { entry_id: string | null; counted_rack: string | null; counted_qty: number | null; arrived_during_count?: boolean }
export type RackPayload = {
  count: CountHeader & { can: CountRights }
  rack: RackView
  expected: ExpectedLot[]
  entries: CountEntry[]
  other_racks: Array<{ key: string; label: string; status: RackStatus }>
  marked_missing?: number
  marked_arrived?: number
}
export type ScanResult = {
  entry?: CountEntry
  result?: { tone: Tone; title: string; detail: string }
  rack: RackView
  replayed?: boolean
  needs_qty?: boolean
  lot?: { entity_type: "REEL" | "BATCH"; entity_id: string; code: string; item_name: string; item_code: string; uom: Uom; status: EntryStatus; expected_location: LocationBrief | null }
}
export type CountStart = { kind: CountKind; month?: string; location_ids?: string[]; item_ids?: string[]; include_unassigned?: boolean; join_open?: boolean; note?: string }

export type BookRow = {
  item_id: string; item_code: string; item_name: string; item_type: string; tracking_mode: string; uom: Uom
  opening: number; received: number; opening_loads: number; sent_back: number; issued: number; corrections: number; count_variance: number
  closing: number; actual_used: number; identity_ok: boolean; has_movement: boolean; book_now?: number
  /** Net qty entered after the approved month-end count but dated into this month; null when none. */
  changed_after_count?: number | null
  /** Why the book does not balance for this item (closing below zero, a lot below zero, …), in words. */
  book_problem?: "NEGATIVE" | "LOT_BELOW_ZERO" | "LEDGER" | "LIVE" | null; book_problem_word?: string | null
}
export type BookUnit = Omit<BookRow, "item_id" | "item_code" | "item_name" | "item_type" | "tracking_mode" | "identity_ok" | "has_movement" | "book_now" | "book_problem" | "book_problem_word" | "changed_after_count"> & { item_count: number; problem_items?: number; negative_items?: number }
export type MonthFigures = {
  plant_id: string; month: string; month_label: string; period_start: string; period_end: string; running: boolean; closed: boolean
  opening_source: "PREVIOUS_CLOSE" | "BOOK_AT_START"
  month_end_count: {
    id: string; count_no: string; status: CountStatus; approved_by: string | null; approved_at: string | null; submitted_by?: string | null; submitted_at?: string | null
    changed_after_count?: boolean; changed_items?: ChangedAfterCount[]
  } | null
  units: BookUnit[]
  items: BookRow[]
}
export type SourceRow = { day: string; kind: string; label: string; qty: number; type: string; lot?: string; doc?: string; reason?: string; shift?: string; section?: string; note?: string; location_code?: string; location_name?: string; at?: string }
export type ItemSources = { item_id: string; item_code: string; item_name: string; uom: Uom; month: string; month_label: string; opening: number; closing: number; rows: SourceRow[]; totals: Record<string, number> }

export type CorrectionLine = {
  id: string; item_id: string; item_code: string | null; item_name: string | null; qty_delta: number; uom: Uom; lot_code: string | null
  new_lot: boolean; location_code: string | null; stock_status: string; notes: string | null; live_qty?: number
  reel_id?: string | null; batch_id?: string | null
  /** Waiting corrections: what other postings changed on the lot since it was raised, and what approving still posts. */
  changed_since?: number; still_to_post?: number
  /** The day the floor got this lot after the correction was raised (it is now used up): approving is refused. */
  issued_since?: string | null
}
export type Correction = {
  id: string; voucher_no: string; status: "DRAFT" | "POSTED" | "CANCELLED"; kind: "CORRECTION" | "COUNT" | "SYSTEM"
  effective_date: string; reason_code: string; reason_label: string; reason_notes: string | null
  created_by: string; created_at: string | null; approved_by: string | null; posted_at: string | null
  cancelled_by: string | null; cancelled_at: string | null; cancel_note: string | null; count_id: string | null; lines: CorrectionLine[]
}
export type CorrectionList = { items: Correction[]; waiting_count: number; reasons: Record<string, string>; can: { approve: boolean; raise: boolean; opening_load: boolean } }
export type CorrectionInput = { code?: string; item_id?: string; location_id?: string; new_qty?: number; not_here?: boolean; reason: string; note?: string }
/** What a typed label is, before a correction is raised. */
export type LotLookup = LotRow & { inward_qty: number | null; returned: boolean; issued_on: string | null; waiting: { id: string; voucher_no: string; created_by: string | null } | null }

const data = <T,>(promise: Promise<{ data: T }>) => promise.then((response) => response.data)

export type ParchmentCoil = { reel_id: string; reel_code: string; kg: number; take_kg: number | null; inward_date: string | null; location: { id: string; code: string; name: string } | null }
export type ParchmentCoils = { item_id: string; item_name: string; uom: string; coils: ParchmentCoil[] }

export const stockApi = {
  locationsOverview: () => data<LocationsOverview>(api.get("/api/inventory/locations/overview")),
  location: (id: string) => data<LocationDetail>(api.get(`/api/inventory/locations/${id}`)),
  createLocation: (body: LocationInput & { code: string; warehouse: string }) => data<LocationRow>(api.post("/api/inventory/locations", body)),
  updateLocation: (id: string, body: LocationInput) => data<LocationRow>(api.patch(`/api/inventory/locations/${id}`, body)),
  unassigned: () => data<{ reels: LotRow[]; lots: LotRow[]; totals: UnitTotal[] }>(api.get("/api/inventory/locations/unassigned")),
  lots: (ids: string[]) => data<{ items: LotRow[]; can: LocationRights }>(api.get("/api/inventory/locations/lots", { params: { ids: ids.join(",") } })),
  /** The parchment coils a by-weight issue takes (oldest cleared first) and where each sits: "Pick from <rack>". */
  parchmentCoils: (itemId: string, qtyKg?: number) => data<ParchmentCoils>(api.get("/api/inventory/reel-issues/by-weight/coils", { params: { item_id: itemId, ...(qtyKg && qtyKg > 0 ? { qty_kg: qtyKg } : {}) } })),
  putAwayAll: (toLocationId?: string) => data<{ moved: number; message: string; to: LocationBrief }>(api.post("/api/inventory/locations/put-away-all", toLocationId ? { to_location_id: toLocationId } : {})),
  scanMove: (body: { to_location_id: string; code: string; client_ref: string }) => data<MoveResult>(api.post("/api/inventory/stock-moves/scan", body)),
  undoMove: (clientRef: string) => data<{ undone: boolean; message: string }>(api.post("/api/inventory/stock-moves/scan/undo", { client_ref: clientRef })),

  counts: () => data<CountList>(api.get("/api/inventory/counts")),
  count: (id: string) => data<CountDetail>(api.get(`/api/inventory/counts/${id}`)),
  startCount: (body: CountStart) => data<CountDetail>(api.post("/api/inventory/counts", body)),
  rack: (id: string, rack: string) => data<RackPayload>(api.get(`/api/inventory/counts/${id}/racks/${rack}`)),
  rackAction: (id: string, rack: string, action: "start" | "done" | "reopen") => data<RackPayload>(api.post(`/api/inventory/counts/${id}/racks/${rack}/${action}`, {})),
  scan: (id: string, body: { rack: string; code: string; counted_qty?: number; client_ref: string; note?: string }) => data<ScanResult>(api.post(`/api/inventory/counts/${id}/scan`, body)),
  addLoose: (id: string, body: { rack: string; item_id: string; counted_qty: number; client_ref: string; scan_code?: string; note?: string }) => data<ScanResult>(api.post(`/api/inventory/counts/${id}/loose`, body)),
  updateEntry: (id: string, entryId: string, body: { counted_qty?: number; note?: string }) => data<CountEntry>(api.patch(`/api/inventory/counts/${id}/entries/${entryId}`, body)),
  undoEntry: (id: string, entryId: string) => data<{ undone: boolean; rack: RackView | null }>(api.post(`/api/inventory/counts/${id}/entries/${entryId}/undo`, {})),
  decide: (id: string, entryId: string, decision: "LEAVE_AS_USED" | "ADD_ON_QC_HOLD") => data<CountEntry>(api.post(`/api/inventory/counts/${id}/entries/${entryId}/decide`, { decision })),
  submit: (id: string, note?: string) => data<CountDetail>(api.post(`/api/inventory/counts/${id}/submit`, { note: note || null })),
  approve: (id: string, note?: string) => data<CountDetail>(api.post(`/api/inventory/counts/${id}/approve`, { note: note || null })),
  sendBack: (id: string, note: string, racks: string[]) => data<CountDetail>(api.post(`/api/inventory/counts/${id}/send-back`, { note, racks })),
  cancel: (id: string, note?: string) => data<CountDetail>(api.post(`/api/inventory/counts/${id}/cancel`, { note: note || null })),

  monthFigures: (month: string) => data<MonthFigures>(api.get("/api/inventory/stock-control/month-figures", { params: { month } })),
  itemSources: (itemId: string, month: string) => data<ItemSources>(api.get(`/api/inventory/stock-control/month-figures/${itemId}/sources`, { params: { month } })),
  lookupLot: (code: string) => data<LotLookup>(api.get("/api/inventory/stock-control/corrections/lookup", { params: { code } })),
  corrections: (status = "ALL") => data<CorrectionList>(api.get("/api/inventory/stock-control/corrections", { params: { status } })),
  raiseCorrection: (body: CorrectionInput) => data<Correction>(api.post("/api/inventory/stock-control/corrections", body)),
  approveCorrection: (id: string, note?: string) => data<Correction>(api.post(`/api/inventory/stock-control/corrections/${id}/approve`, { note: note || null })),
  rejectCorrection: (id: string, note: string) => data<Correction>(api.post(`/api/inventory/stock-control/corrections/${id}/cancel`, { note })),
}

// Plain words, numbers and dates for the stock pages live in lib/stock-format.ts (no app imports, so the
// unit tests can load them); they are re-exported here so pages import one module.
export {
  COUNT_STATUS_TONE, PURPOSE_WORD, RACK_STATUS, clientRef, dayText, daysHere, errorCode, isWholeUnit, monthText, pickFromText, placeText, plural, qtyText, reasonWord, rupees,
  shiftMonth, signedQty, timeText, unitName, unitTotalsText, unitWord, who,
} from "./stock-format"

/** A server refusal in plain words, with any login in it shown as the person's directory name
 * ("raised by test.grn" → "raised by GRN desk"). */
export function errorText(error: any, fallback?: string): string {
  return peopleInText(plainErrorText(error, fallback))
}

const ONE_UNIT: Record<string, string> = { pcs: "pc", boxes: "box", rolls: "roll", sets: "set", packets: "packet", bags: "bag", drums: "drum" }

/** Stock on a place, one figure per unit, to one decimal ("9,895.9 kg · 1 pc"); kg and pcs never added. */
export function stockTotalsText(totals: UnitTotal[] | undefined): string {
  return (totals || []).filter((row) => Math.abs(row.qty) > 0.0005).map((row) => {
    const text = qtyText(row.qty, row.uom, 1)
    if (!isWholeUnit(row.uom) || Math.round(row.qty) !== 1) return text
    const [number, word] = [text.slice(0, text.lastIndexOf(" ")), text.slice(text.lastIndexOf(" ") + 1)]
    return ONE_UNIT[word] ? `${number} ${ONE_UNIT[word]}` : text
  }).join(" · ")
}

/** "Last counted 30 Oct 2026", or "Counted 30 Oct 2026 · waiting for approval" while that count is not approved. */
export function countedText(at: string | null | undefined, approved: boolean | undefined): string {
  if (!at) return "Not counted yet"
  return approved === false ? `Counted ${dayText(at)} · waiting for approval` : `Last counted ${dayText(at)}`
}
