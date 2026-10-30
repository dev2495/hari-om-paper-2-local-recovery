/**
 * A typed number on the issue desks works like a scan (client 2026-10-30). The server
 * (GET /api/inventory/labels/find) finds the lots, reels and coils of this plant whose lot / Amigo inward,
 * AT, vendor reel, old mark or GRN number matches what was typed — any case, spaces or separators, or a
 * unique part — oldest first. This file decides what the desk does with them. No app imports, so unit
 * tests load it directly.
 */

export type FoundRow = {
  kind: "LOT" | "REEL"
  id: string
  /** The printed number: lot / Amigo inward number, or the AT number. */
  code: string
  item_id: string
  item_code?: string | null
  item_name?: string | null
  item_type?: string | null
  tracking_mode?: string | null
  uom: string
  qty: number
  stock_status: string
  /** Reels only: IN_STOCK, ISSUED, CONSUMED or SCRAP. */
  status?: string | null
  physical_form?: string | null
  plant_id: string
  location_id?: string | null
  location_code?: string | null
  location_name?: string | null
  in_since?: string | null
  created_at?: string | null
  grn_no?: string | null
  vendor_reel_no?: string | null
  old_mark?: string | null
  matched_on: "LOT_NO" | "GRN" | "OLD_MARK" | "AT_NO" | "VENDOR_REEL"
  matched_value: string
}

export type FoundResult = { code: string; match: "EXACT" | "PARTIAL" | "NONE"; count: number; truncated: boolean; rows: FoundRow[] }

export type FoundChoice = { row?: FoundRow; rows: FoundRow[]; note?: string }

const CLEARED = ["UNRESTRICTED", "WIP"]

/** Letters and digits only, upper case: "in 26 028 b002" and "IN/26/028-B002" are the same number. */
export function compactNumber(value: unknown): string {
  return String(value ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase()
}

/** Same number, whatever the case, spaces, slashes or dashes. A blank never matches. */
export function sameNumber(a: unknown, b: unknown): boolean {
  const left = compactNumber(a)
  return Boolean(left) && left === compactNumber(b)
}

/** In stock, passed incoming QC, something left (and, for a reel, not already issued). */
export function isReady(row: FoundRow): boolean {
  if (row.kind === "REEL" && String(row.status || "").toUpperCase() !== "IN_STOCK") return false
  return Number(row.qty || 0) > 1e-9 && CLEARED.includes(String(row.stock_status || "").toUpperCase())
}

/**
 * One match: that one. Several with the same full number (a GRN with two lots, an old mark on a used-up
 * reel too) and exactly one of them can go: that one, with a note. Otherwise a short pick list, the ones
 * that can go first, oldest first.
 */
export function chooseFound(found: Pick<FoundResult, "match" | "rows">, usable: (row: FoundRow) => boolean = isReady): FoundChoice {
  const rows = Array.isArray(found?.rows) ? found.rows : []
  if (rows.length === 1) return { row: rows[0], rows }
  const ready = rows.filter(usable)
  if (found.match === "EXACT" && ready.length === 1 && rows.length > 1) {
    const others = rows.length - 1
    return { row: ready[0], rows, note: `${others === 1 ? "One other" : `${others} others`} with this number cannot be issued; ${ready[0].code} is the one in stock and cleared.` }
  }
  return { rows: [...ready, ...rows.filter((row) => !ready.includes(row))] }
}

/** Short words for a pick-list row: why it can or cannot go. */
export function foundWords(row: FoundRow): { text: string; tone: "emerald" | "blue" | "amber" | "rose" | "slate" } {
  const status = String(row.stock_status || "").toUpperCase()
  const reelState = String(row.status || "").toUpperCase()
  if (row.kind === "REEL" && (reelState === "CONSUMED" || reelState === "ISSUED")) return { text: "Already issued", tone: "slate" }
  if (row.kind === "REEL" && reelState === "SCRAP") return { text: "Scrapped", tone: "slate" }
  if (Number(row.qty || 0) <= 1e-9) return { text: "Used up", tone: "slate" }
  if (status === "BLOCKED") return { text: "Rejected by QC", tone: "rose" }
  if (status === "QC_HOLD") return { text: "Waiting for QC", tone: "blue" }
  if (!CLEARED.includes(status)) return { text: status.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase()) || "Not cleared", tone: "amber" }
  return { text: "Cleared", tone: "emerald" }
}

/** "3 lots match 028" / "2 reels match CK3UI-1" / "2 match B002" for mixed rows. */
export function matchWords(rows: FoundRow[], code: string, count = rows.length): string {
  const kinds = new Set(rows.map((row) => row.kind))
  const noun = kinds.size > 1 ? "" : kinds.has("REEL") ? (count === 1 ? " reel or coil" : " reels and coils") : count === 1 ? " lot" : " lots"
  return `${count}${noun} match ${code}`
}
