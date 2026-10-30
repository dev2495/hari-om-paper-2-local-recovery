/**
 * Opening stock rows (client 2026-10-30): one reel / coil (weight in kg) or one bulk lot (qty in the item's own
 * unit) per row, typed, duplicated or pasted from Excel. Pure functions with no React or app imports, so the
 * node unit tests load this file directly.
 *
 * Paste columns, in this order (a header row is skipped): item code or name, type (reel / coil / bulk),
 * weight or qty, location, old mark, vendor, rate. Tabs (Excel) or commas between cells. A name that fits
 * several materials or places is never guessed: the row stays red and lists them.
 */

export type RowKind = "REEL" | "BULK"
export type ItemOption = { id: string; item_code: string; name: string; type: string; tracking_mode: string; uom: string; unit_cost?: number | null; active?: string | boolean }
export type PlaceOption = { id: string; code: string; name: string; active: boolean; purpose?: string | null; is_receiving_default?: boolean }

export type DraftRow = {
  key: string
  kind: RowKind
  item_id: string
  /** What was pasted for the item / location when it matched nothing: shown in red with a pick list. */
  item_text: string
  qty: string
  location_id: string
  location_text: string
  old_mark: string
  vendor_name: string
  vendor_ref: string
  rate: string
  on_hold: boolean
  hold_reason: string
  /** A note from the paste, e.g. the typed type did not match how the material is kept. */
  note: string
  /** When a pasted cell fits several materials / places: their codes, so the row asks which one. */
  item_matches?: string[]
  location_matches?: string[]
}

let seq = 0
export function rowKey(): string {
  seq += 1
  return `r${Date.now().toString(36)}${seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

export function blankRow(kind: RowKind = "REEL", location_id = ""): DraftRow {
  return { key: rowKey(), kind, item_id: "", item_text: "", qty: "", location_id, location_text: "", old_mark: "", vendor_name: "", vendor_ref: "", rate: "", on_hold: false, hold_reason: "", note: "" }
}

/** A copy of the row under it: same material, place, vendor and rate; the old mark and weight are left to type. */
export function duplicateRow(row: DraftRow): DraftRow {
  return { ...row, key: rowKey(), qty: "", old_mark: "", note: "" }
}

export function isBlank(row: DraftRow): boolean {
  return !row.item_id && !row.item_text && !row.qty.trim() && !row.old_mark.trim() && !row.vendor_name.trim() && !row.rate.trim()
}

/** Reel-tracked materials (paper reels, parchment coils) are entered as reels; everything else as bulk lots. */
export function kindOf(item: ItemOption | undefined): RowKind {
  return String(item?.tracking_mode || "").toUpperCase() === "REEL" ? "REEL" : "BULK"
}

const norm = (value: string) => value.toLowerCase().replace(/[\s._\-/]+/g, "")

export type Match<T> = { match?: T; candidates: T[] }

/**
 * What a pasted cell means: an exact code, else an exact name, else a partial match, each taken only when
 * exactly one fits. Several fits (five materials all named "Kraft 350 GSM") are never guessed: the
 * candidates come back so the row asks which one.
 */
function pick<T>(text: string, rows: T[], code: (row: T) => string, name: (row: T) => string): Match<T> {
  const wanted = norm(text)
  if (!wanted) return { candidates: [] }
  for (const fits of [
    (row: T) => norm(code(row)) === wanted,
    (row: T) => norm(name(row)) === wanted,
    (row: T) => norm(name(row)).includes(wanted) || norm(code(row)).includes(wanted),
  ]) {
    const found = rows.filter(fits)
    if (found.length === 1) return { match: found[0], candidates: found }
    if (found.length > 1) return { candidates: found }
  }
  return { candidates: [] }
}

export function findItem(text: string, items: ItemOption[]): Match<ItemOption> {
  return pick(text, items, (item) => item.item_code, (item) => item.name)
}

export function findPlace(text: string, places: PlaceOption[]): Match<PlaceOption> {
  return pick(text, places.filter((place) => place.active), (place) => place.code, (place) => place.name)
}

/** The one material a pasted cell means, or undefined when none or several fit. */
export function matchItem(text: string, items: ItemOption[]): ItemOption | undefined {
  return findItem(text, items).match
}

export function matchPlace(text: string, places: PlaceOption[]): PlaceOption | undefined {
  return findPlace(text, places).match
}

/** "350, 351, 352…" for the row's message. */
export function choicesText(codes: string[] | undefined, shown = 3): string {
  const list = (codes || []).filter(Boolean)
  return list.slice(0, shown).join(", ") + (list.length > shown ? "…" : "")
}

function typedKind(text: string): RowKind | null {
  const value = text.trim().toLowerCase()
  if (!value) return null
  if (/^(reel|reels|coil|coils|r|c)$/.test(value)) return "REEL"
  if (/^(bulk|lot|lots|bag|bags|b|drum|box|boxes)$/.test(value)) return "BULK"
  return null
}

/** "1,234.5", "1234.5 kg", "₹ 42" → "1234.5"; anything else stays as typed (the row then shows an error). */
export function cleanNumber(text: string): string {
  const value = String(text || "").replace(/[₹,\s]/g, "").replace(/(kg|kgs|pcs|nos|l|ltr|rs)$/i, "")
  return /^\d*\.?\d+$/.test(value) ? value : String(text || "").trim()
}

function splitLine(line: string): string[] {
  if (line.includes("\t")) return line.split("\t").map((cell) => cell.trim())
  // Commas, with "quoted, cells" kept whole.
  const cells: string[] = []
  let current = ""
  let quoted = false
  for (const char of line) {
    if (char === '"') quoted = !quoted
    else if (char === "," && !quoted) { cells.push(current.trim()); current = "" }
    else current += char
  }
  cells.push(current.trim())
  return cells
}

const HEADER = /^(item|material|code|name|item code)/i

/** Rows from text copied out of Excel: items and locations matched, the rest kept as typed. */
export function parsePaste(text: string, items: ItemOption[], places: PlaceOption[], defaultPlace = ""): DraftRow[] {
  const lines = String(text || "").replace(/\r/g, "").split("\n").filter((line) => line.trim())
  const rows: DraftRow[] = []
  lines.forEach((line, index) => {
    const [itemCell = "", typeCell = "", qtyCell = "", placeCell = "", markCell = "", vendorCell = "", rateCell = ""] = splitLine(line)
    if (index === 0 && HEADER.test(itemCell) && !/\d/.test(qtyCell)) return
    const itemFound = findItem(itemCell, items)
    const placeFound = findPlace(placeCell, places)
    const item = itemFound.match
    const place = placeFound.match
    const asked = typedKind(typeCell)
    const kind = item ? kindOf(item) : asked || "REEL"
    const note = item && asked && asked !== kind
      ? `Typed as ${asked === "REEL" ? "a reel" : "bulk"}, but ${item.name} is kept as ${kind === "REEL" ? "reels" : "bulk lots"}, so it is entered as ${kind === "REEL" ? "a reel" : "a bulk lot"}.`
      : ""
    rows.push({
      ...blankRow(kind, place?.id || (placeCell.trim() ? "" : defaultPlace)),
      item_id: item?.id || "",
      item_text: item ? "" : itemCell.trim(),
      qty: cleanNumber(qtyCell),
      location_text: place || !placeCell.trim() ? "" : placeCell.trim(),
      old_mark: markCell,
      vendor_name: vendorCell,
      rate: rateCell ? cleanNumber(rateCell) : "",
      note,
      item_matches: item ? undefined : itemFound.candidates.length > 1 ? itemFound.candidates.map((row) => row.item_code || row.name) : undefined,
      location_matches: place ? undefined : placeFound.candidates.length > 1 ? placeFound.candidates.map((row) => row.code) : undefined,
    })
  })
  return rows
}

/** Only the "matched nothing / several" problems of a pasted row (the paste summary counts these apart). */
export function matchProblems(row: DraftRow): Array<{ field: string; message: string }> {
  return rowProblems(row).filter((problem) => problem.field === "item" || problem.field === "location")
}

/** Units counted in whole things (as lib/stock-format isWholeUnit; this file has no app imports). */
const WHOLE_UNITS: Record<string, string> = { PCS: "pieces", NOS: "numbers", BOX: "boxes", ROLL: "rolls", SET: "sets", PKT: "packets", BAG: "bags", DRUM: "drums" }

/** Problems the page shows on the row before the server checks it (unmatched paste, numbers). Pass the
 * material's unit so a fraction of a piece is caught as it is typed. */
export function rowProblems(row: DraftRow, uom?: string): Array<{ field: string; message: string }> {
  const problems: Array<{ field: string; message: string }> = []
  if (row.item_text && !row.item_id) {
    problems.push({ field: "item", message: row.item_matches?.length
      ? `"${row.item_text}" matches ${row.item_matches.length} materials (${choicesText(row.item_matches)}): pick one.`
      : `"${row.item_text}" is not a material of this plant. Pick one.` })
  }
  if (row.location_text && !row.location_id) {
    problems.push({ field: "location", message: row.location_matches?.length
      ? `"${row.location_text}" matches ${row.location_matches.length} locations (${choicesText(row.location_matches)}): pick one.`
      : `"${row.location_text}" is not an active store rack of this plant. Pick one.` })
  }
  const qty = Number(row.qty)
  const whole = row.kind === "BULK" ? WHOLE_UNITS[String(uom || "").toUpperCase()] : undefined
  if (row.qty.trim() && !(qty > 0)) problems.push({ field: "qty", message: row.kind === "REEL" ? "Weight must be more than 0 kg." : "Quantity must be more than 0." })
  else if (row.qty.trim() && whole && !Number.isInteger(qty)) problems.push({ field: "qty", message: `Counted in whole ${whole}: enter ${Math.floor(qty)} or ${Math.floor(qty) + 1}, not ${row.qty.trim()}.` })
  if (row.rate.trim() && !(Number(row.rate) >= 0)) problems.push({ field: "rate", message: "Rate must be a number." })
  return problems
}

/** The payload line for a row (blank rows are left out by the caller). */
export function toLine(row: DraftRow) {
  return {
    item_id: row.item_id,
    kind: row.kind,
    qty: Number(row.qty) || 0,
    location_id: row.location_id || undefined,
    old_mark: row.old_mark.trim() || undefined,
    vendor_name: row.vendor_name.trim() || undefined,
    vendor_ref: row.vendor_ref.trim() || undefined,
    on_hold: row.on_hold || undefined,
    hold_reason: row.on_hold ? row.hold_reason.trim() || undefined : undefined,
    unit_cost: row.rate.trim() && Number(row.rate) >= 0 ? Number(row.rate) : undefined,
  }
}
