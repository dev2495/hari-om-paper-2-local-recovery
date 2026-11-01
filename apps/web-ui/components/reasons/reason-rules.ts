/**
 * Reasons are master codes only (owner decision 4, 1 Nov 2026). Pure rules shared by the reason picker,
 * its hook and tests; the server applies the same rules (services' `reasons.py`, master data `reason_catalog.py`).
 */

export type ReasonRow = { id?: string; code: string; label?: string; category?: string; description?: string; active?: boolean; is_active?: boolean; severity?: string }
export type ReasonValue = { code: string; note: string }
export type ReasonPayload = { reason_code: string; reason_note?: string } & Record<string, string | undefined>

export const OTHER_NOTE_MIN = 5
export const EMPTY_REASON: ReasonValue = { code: "", note: "" }

/** A code with OTHER / OTHERS as a whole word (SO-OTHER, QH-OTHER) needs a note; ANOTHER or MOTHER does not. */
export const reasonNeedsNote = (code: string) => /(^|[^A-Z0-9])OTHERS?($|[^A-Z0-9])/.test(String(code || "").trim().toUpperCase())

export const reasonIsActive = (row: ReasonRow) => row.active !== false && row.is_active !== false

/** Plain-English problem with a choice, or null when it is complete. */
export function reasonProblem(value: ReasonValue, required = true): string | null {
  const code = String(value.code || "").trim()
  if (!code) return required ? "Choose a reason from the list." : null
  if (reasonNeedsNote(code) && String(value.note || "").trim().length < OTHER_NOTE_MIN) return `Write a short note (at least ${OTHER_NOTE_MIN} characters) for Other.`
  return null
}

export const reasonComplete = (value: ReasonValue, required = true) => reasonProblem(value, required) === null

export function reasonLabel(rows: ReasonRow[] | undefined, code: string) {
  const wanted = String(code || "").trim().toUpperCase()
  const row = (rows || []).find((item) => String(item.code || "").toUpperCase() === wanted)
  return row?.label || wanted
}

/** "Label — note" (or just the label): the legacy free-text form older endpoints and records read. */
export function reasonText(rows: ReasonRow[] | undefined, value: ReasonValue) {
  const label = reasonLabel(rows, value.code)
  const note = String(value.note || "").trim()
  return note ? `${label} — ${note}` : label
}

/**
 * Body fields for a request: `reason_code`, `reason_note`, plus the old free-text field (`legacyKey`,
 * default "reason") filled with "Label — note" so paths that still read it keep working.
 */
export function reasonPayload(rows: ReasonRow[] | undefined, value: ReasonValue, legacyKey: string | null = "reason"): ReasonPayload {
  const note = String(value.note || "").trim()
  const out: ReasonPayload = { reason_code: String(value.code || "").trim().toUpperCase() }
  if (note) out.reason_note = note
  if (legacyKey) out[legacyKey] = reasonText(rows, value)
  return out
}

/** Rows matching a search (code, label or description), active only, label order. */
export function filterReasons(rows: ReasonRow[] | undefined, search: string) {
  const needle = search.trim().toLowerCase()
  return (rows || [])
    .filter(reasonIsActive)
    .filter((row) => !needle || [row.code, row.label, row.description].some((v) => String(v || "").toLowerCase().includes(needle)))
}

/** Shows a stored reason: "Label (CODE)" when both are known, the old text otherwise. */
export function storedReasonText(record: { reason_label?: string | null; reason_code?: string | null; reason_note?: string | null; reason?: string | null } | null | undefined) {
  if (!record) return ""
  const label = String(record.reason_label || "").trim()
  const code = String(record.reason_code || "").trim()
  const note = String(record.reason_note || "").trim()
  if (label || code) return [label || code, note].filter(Boolean).join(" — ")
  return String(record.reason || "").trim()
}
