// Packing setup (owner decision 5, 1 Nov 2026): box, qty per box, plastic and fadda per spec from the
// Packaging masters. Pure helpers shared by the Packing setup page and the spec sheet; the server
// (spec-service /specs/{id}/packing) applies the same rules.

export type PackagingKind = "BOX" | "PLASTIC" | "FADDA"

export type PackagingMaster = {
  code: string
  size_label?: string | null
  weight_kg?: number | null
  length_mm?: number | null
  width_mm?: number | null
  height_mm?: number | null
}

export type SpecPacking = {
  box_code: string
  qty_per_box: number | null
  box_size?: string
  box_unit_weight_kg?: number | null
  plastic_sku: string
  plastic_per_box: number | null
  plastic_unit_weight_kg?: number | null
  fadda_sku: string
  fadda_per_box: number | null
  fadda_unit_weight_kg?: number | null
}

export type PackingSetupRow = {
  id: string
  version: number
  status: string
  seasonal_model: boolean
  write_revision: number
  customer_id?: string | null
  customer_name: string
  id_min_mm?: number | null
  id_max_mm?: number | null
  od_min_mm?: number | null
  od_max_mm?: number | null
  length_min_mm?: number | null
  length_max_mm?: number | null
  target_tube_weight?: number | null
  packing: SpecPacking
  complete: boolean
  blockers: string[]
  last_amendment?: { summary: string; actor: string; created_at: string; job_cards_updated?: number | null } | null
}

/** What the person is editing in one row. Counts stay strings so an empty box reads as empty. */
export type PackingDraft = {
  box_code: string
  qty_per_box: string
  plastic_sku: string
  plastic_per_box: string
  fadda_sku: string
  fadda_per_box: string
}

export type PackingMasters = { boxes: PackagingMaster[]; plastics: PackagingMaster[]; fadda: PackagingMaster[] }

const code = (value: unknown) => String(value ?? "").trim().toUpperCase()
const count = (value: number | null | undefined) => (value === null || value === undefined ? "" : String(value))

export function masterCodes(list: PackagingMaster[]): Set<string> {
  return new Set(list.map((row) => code(row.code)).filter(Boolean))
}

/** The only active master of a kind is the default; with none or several there is no default. */
export function singleDefault(list: PackagingMaster[]): string {
  return list.length === 1 ? code(list[0].code) : ""
}

/** A row's draft: the spec's own values, with plastic/fadda defaulted when the spec has none chosen. */
export function draftFromPacking(packing: SpecPacking, masters: PackingMasters): PackingDraft {
  const plasticDefault = singleDefault(masters.plastics)
  const faddaDefault = singleDefault(masters.fadda)
  const plastic = code(packing.plastic_sku) || plasticDefault
  const fadda = code(packing.fadda_sku) || faddaDefault
  return {
    box_code: code(packing.box_code),
    qty_per_box: count(packing.qty_per_box),
    plastic_sku: plastic,
    plastic_per_box: plastic ? count(packing.plastic_per_box) || "1" : count(packing.plastic_per_box) || "0",
    fadda_sku: fadda,
    fadda_per_box: fadda ? count(packing.fadda_per_box) || "1" : count(packing.fadda_per_box) || "0",
  }
}

function numberOrNull(value: string): number | null {
  if (String(value).trim() === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** Plain-English problems that stop this draft from saving (mirrors the server check). */
export function draftProblems(draft: PackingDraft, masters: PackingMasters): string[] {
  const problems: string[] = []
  const boxes = masterCodes(masters.boxes)
  if (!draft.box_code) problems.push("Choose the box")
  else if (!boxes.has(code(draft.box_code))) problems.push(`Box ${draft.box_code} is not in the Packaging master`)
  const qty = numberOrNull(draft.qty_per_box)
  if (qty === null || qty <= 0 || !Number.isInteger(qty)) problems.push("Enter qty per box (whole pcs)")
  for (const [label, sku, perBox, list] of [
    ["Plastic", draft.plastic_sku, draft.plastic_per_box, masters.plastics],
    ["Fadda", draft.fadda_sku, draft.fadda_per_box, masters.fadda],
  ] as const) {
    const n = numberOrNull(perBox)
    if (n !== null && n < 0) problems.push(`${label} per box cannot be negative`)
    if (sku && !masterCodes(list).has(code(sku))) problems.push(`${label} ${sku} is not in the Packaging master`)
    if (sku && !n) problems.push(`${label} per box must be at least 1 (or choose no ${label.toLowerCase()})`)
    if (!sku && n) problems.push(`Choose the ${label.toLowerCase()} or set ${label.toLowerCase()} per box to 0`)
  }
  return problems
}

/** Has the person changed anything the spec would store? (A count without its material stores as 0.) */
export function draftChanged(draft: PackingDraft, packing: SpecPacking): boolean {
  const stored = (sku: string, perBox: number | null) => (code(sku) ? `${code(sku)}×${perBox ?? 0}` : "")
  const drafted = (sku: string, perBox: string) => (code(sku) ? `${code(sku)}×${numberOrNull(perBox) ?? 0}` : "")
  return (
    code(draft.box_code) !== code(packing.box_code) ||
    (numberOrNull(draft.qty_per_box) ?? 0) !== (packing.qty_per_box ?? 0) ||
    drafted(draft.plastic_sku, draft.plastic_per_box) !== stored(packing.plastic_sku, packing.plastic_per_box) ||
    drafted(draft.fadda_sku, draft.fadda_per_box) !== stored(packing.fadda_sku, packing.fadda_per_box)
  )
}

/** Request body for PUT /api/spec/specifications/{id}/packing. */
export function draftPayload(draft: PackingDraft, row: PackingSetupRow, requestId: string) {
  return {
    request_id: requestId,
    expected_version: row.write_revision,
    box_code: code(draft.box_code),
    qty_per_box: Number(draft.qty_per_box),
    plastic_sku: code(draft.plastic_sku) || null,
    plastic_per_box: code(draft.plastic_sku) ? Number(draft.plastic_per_box) : 0,
    fadda_sku: code(draft.fadda_sku) || null,
    fadda_per_box: code(draft.fadda_sku) ? Number(draft.fadda_per_box) : 0,
  }
}

/** Box codes the specs use that have no box master yet, most used first (to add them in the master). */
export function boxCodesNotInMaster(rows: PackingSetupRow[], boxes: PackagingMaster[]): Array<{ code: string; specs: number }> {
  const known = masterCodes(boxes)
  const counts = new Map<string, number>()
  for (const row of rows) {
    const box = code(row.packing.box_code)
    if (box && !known.has(box)) counts.set(box, (counts.get(box) || 0) + 1)
  }
  return Array.from(counts, ([value, specs]) => ({ code: value, specs })).sort((a, b) => b.specs - a.specs || a.code.localeCompare(b.code))
}

export type PackingFilters = { missingOnly: boolean; customerId: string; search: string }

export function filterPackingRows(rows: PackingSetupRow[], filters: PackingFilters): PackingSetupRow[] {
  const term = filters.search.trim().toLowerCase()
  return rows.filter((row) => {
    if (filters.missingOnly && row.complete) return false
    if (filters.customerId && row.customer_id !== filters.customerId) return false
    if (!term) return true
    const haystack = [row.customer_name, row.id, row.packing.box_code, `v${row.version}`, sizeText(row)].join(" ").toLowerCase()
    return haystack.includes(term)
  })
}

const band = (min?: number | null, max?: number | null) =>
  min == null && max == null ? "—" : min === max || max == null ? String(min ?? max) : min == null ? String(max) : `${min}–${max}`

export function sizeText(row: Pick<PackingSetupRow, "id_min_mm" | "id_max_mm" | "od_min_mm" | "od_max_mm" | "length_min_mm" | "length_max_mm">): string {
  return `${band(row.id_min_mm, row.id_max_mm)} × ${band(row.od_min_mm, row.od_max_mm)} × ${band(row.length_min_mm, row.length_max_mm)} mm`
}

export function addBoxHref(boxCode: string): string {
  return `/masters/packaging?add=box&code=${encodeURIComponent(boxCode)}`
}
