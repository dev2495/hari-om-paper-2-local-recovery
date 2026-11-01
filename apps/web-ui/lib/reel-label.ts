/**
 * The plant's own reel / coil label (owner decision 6, 1 Nov 2026), from their Excel "REEL PRINT.":
 *
 *   heading (plant master "label heading")
 *   MILL NAME | Inv No. | Date (28-Oct-26)
 *   PLYBOND   | VARIETY | GSM
 *   400       | 351     | 351
 *   ROLL NO.  | 65686
 *   AIT 06243   (very large)
 *   WEIGHT    | 1161
 *
 * plus a QR (the same /scan link as before). Nothing more: no vendor / received / GRN / PO / QC words, no
 * "(spec)" marks. The server works the lines out when a label is printed (`facts`); the page adds the heading
 * and, for reels received before the mill name was kept at inward, the vendor master's mill / short name.
 */

export type PlantReelFacts = {
  serial?: string
  mill?: string
  vendor?: string
  supplier_id?: string
  invoice_no?: string
  received_date?: string
  plybond?: string
  variety?: string
  gsm?: string
  roll_no?: string
  weight_kg?: string
  form?: string
}

/** A reel / coil label in the plant layout (server facts carry a serial). */
export function isPlantReelFacts(value: unknown): value is PlantReelFacts {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && typeof (value as any).serial === "string" && (value as any).serial)
}

type PlantRow = { id?: string; code?: string; name?: string | null; legal_name?: string | null; label_heading?: string | null; label_heading_effective?: string | null }

/** The label heading: the plant's own, else its legal name, else its name, in capitals. */
export function labelHeading(plant: PlantRow | null | undefined): string {
  const text = String(plant?.label_heading_effective || plant?.label_heading || plant?.legal_name || plant?.name || "").trim()
  return text.replace(/\s+/g, " ").toUpperCase()
}

type VendorRow = { id?: string; short_name?: string | null; trade_name?: string | null; name?: string | null }

/** MILL NAME: kept at inward, else the vendor master's mill / short name, else the vendor name as received. */
export function millName(facts: PlantReelFacts, vendors?: VendorRow[] | null): string {
  if (facts.mill) return facts.mill
  const vendor = (vendors || []).find((row) => facts.supplier_id && String(row.id) === String(facts.supplier_id))
  return String(vendor?.short_name || facts.vendor || "").trim().toUpperCase()
}

/** Width of a text in em for a bold sans face (Arial / Helvetica Bold), close enough to fit a cell. */
export function textEm(text: string): number {
  let width = 0
  for (const char of text) {
    if (/[0-9]/.test(char)) width += 0.556
    else if (/[A-Z]/.test(char)) width += char === "I" ? 0.28 : char === "M" || char === "W" ? 0.833 : 0.722
    else if (/[a-z]/.test(char)) width += 0.58
    else if (char === " ") width += 0.278
    else width += 0.36
  }
  return width
}

/**
 * Font size (in the label's width units, cqw) that fits ``text`` across ``room`` cqw, at most ``base``.
 * Long invoice numbers or coil serials step down instead of spilling out of their cell.
 */
export function fitSize(text: string | undefined | null, base: number, room: number): number {
  const value = String(text ?? "")
  const em = textEm(value)
  if (!em) return base
  return Math.round(Math.min(base, (room * 0.92) / em) * 100) / 100
}
