/**
 * Monthly RM / PM purchase schedule maths, modelled on the plant's planning workbook:
 *
 *   op stk + scheduled arrivals - requirement = cl stk          (per lane and per GSM variety)
 *   short PO = scheduled with vendor - pending PO with vendor   (positive: raise a PO for it)
 *
 * Quantities are held in the item's base unit (kg, or pcs for packing).
 */

export type MaterialClass = "PAPER" | "CHEMICAL" | "PACKING"

export const MATERIAL_CLASSES: Array<{ id: MaterialClass; label: string; tag: "RM" | "PM"; types: string[]; baseUnit: "KG" | "PCS" }> = [
  { id: "PAPER", label: "Paper", tag: "RM", types: ["RAW_PAPER"], baseUnit: "KG" },
  { id: "CHEMICAL", label: "Chemicals & adhesive", tag: "RM", types: ["ADHESIVE", "PARCHMENT", "OTHER"], baseUnit: "KG" },
  { id: "PACKING", label: "Packing", tag: "PM", types: ["PACKAGING"], baseUnit: "PCS" },
]

export const OPEN_PO_STATUSES = new Set(["SUBMITTED", "APPROVED", "PARTIALLY_RECEIVED"])

export function classOfItem(item: { type?: string } | null | undefined): MaterialClass | null {
  const type = String(item?.type || "")
  return MATERIAL_CLASSES.find((entry) => entry.types.includes(type))?.id ?? null
}

/** BOM demand row -> planner class (paper rows have no material_class). */
export function classOfDemand(row: { material_class?: string }): MaterialClass {
  const value = String(row.material_class || "PAPER")
  if (value === "PACKING") return "PACKING"
  if (value === "ADHESIVE" || value === "PARCHMENT") return "CHEMICAL"
  return "PAPER"
}

/** GSM from a paper code or name: "KRAFT-230-18BF" -> 230, "VP 351" -> 351. */
export function paperGsm(item: { item_code?: string; name?: string; gsm?: number | string } | null | undefined): number | null {
  const direct = Number(item?.gsm)
  if (Number.isFinite(direct) && direct > 0) return direct
  for (const source of [item?.item_code, item?.name]) {
    for (const match of String(source || "").matchAll(/(?<![\d.])(\d{2,3})(?![\d.])/g)) {
      const value = Number(match[1])
      if (value >= 80 && value <= 700) return value
    }
  }
  return null
}

export type LaneFigures = { itemId: string; opening: number; scheduled: number; required: number; bomRequired: number; manual: boolean; closing: number }

export function laneFigures(args: {
  itemIds: string[]
  scheduledByItem: Record<string, number>
  openingByItem: Record<string, number>
  bomByItem: Record<string, number>
  manualByItem?: Record<string, number | undefined>
}): Record<string, LaneFigures> {
  const out: Record<string, LaneFigures> = {}
  for (const itemId of args.itemIds) {
    const manualValue = args.manualByItem?.[itemId]
    const manual = manualValue !== undefined && manualValue !== null && Number.isFinite(Number(manualValue))
    const bomRequired = round3(args.bomByItem[itemId] || 0)
    const required = manual ? round3(Number(manualValue)) : bomRequired
    const opening = round3(args.openingByItem[itemId] || 0)
    const scheduled = round3(args.scheduledByItem[itemId] || 0)
    out[itemId] = { itemId, opening, scheduled, required, bomRequired, manual, closing: round3(opening + scheduled - required) }
  }
  return out
}

export type VarietyGroup = { key: string; label: string; gsm: number | null; itemIds: string[]; opening: number; scheduled: number; required: number; closing: number }

/** Workbook "VARIETY TOTAL": lanes of the same GSM from different vendors are one variety. */
export function varietyGroups(lanes: Array<{ id: string; item_code?: string; name?: string }>, figures: Record<string, LaneFigures>): VarietyGroup[] {
  const groups = new Map<string, VarietyGroup>()
  for (const lane of lanes) {
    const gsm = paperGsm(lane)
    const key = gsm === null ? `item:${lane.id}` : `gsm:${gsm}`
    const group = groups.get(key) || { key, label: gsm === null ? String(lane.item_code || "Other") : `${gsm} GSM`, gsm, itemIds: [], opening: 0, scheduled: 0, required: 0, closing: 0 }
    const row = figures[String(lane.id)]
    group.itemIds.push(String(lane.id))
    if (row) {
      group.opening = round3(group.opening + row.opening)
      group.scheduled = round3(group.scheduled + row.scheduled)
      group.required = round3(group.required + row.required)
      group.closing = round3(group.opening + group.scheduled - group.required)
    }
    groups.set(key, group)
  }
  return Array.from(groups.values()).sort((a, b) => (a.gsm ?? 9999) - (b.gsm ?? 9999) || a.label.localeCompare(b.label))
}

export type OpenPoBalance = { supplierId: string; supplierName: string; qty: number; byItem: Record<string, number>; poNos: string[] }

/** Pending PO quantity per vendor for the given items (ordered - received - short-closed). */
export function openPoBalances(orders: any[], itemIds: Set<string>): Record<string, OpenPoBalance> {
  const out: Record<string, OpenPoBalance> = {}
  for (const order of orders || []) {
    if (!OPEN_PO_STATUSES.has(String(order?.status || "").toUpperCase())) continue
    const supplierId = String(order.supplier_id || order.supplier_name || "unknown")
    for (const line of order.lines || []) {
      const itemId = String(line.item_id || "")
      if (!itemIds.has(itemId)) continue
      const open = Math.max(0, Number(line.qty_ordered || 0) - Number(line.qty_received || 0) - Number(line.qty_short_closed || 0))
      if (open <= 0) continue
      const entry = (out[supplierId] ||= { supplierId, supplierName: String(order.supplier_name || "Vendor"), qty: 0, byItem: {}, poNos: [] })
      entry.qty = round3(entry.qty + open)
      entry.byItem[itemId] = round3((entry.byItem[itemId] || 0) + open)
      if (order.po_no && !entry.poNos.includes(order.po_no)) entry.poNos.push(order.po_no)
    }
  }
  return out
}

export type VendorPosition = { vendorId: string; vendorName: string; scheduled: number; pendingPo: number; shortPo: number; toRaise: number; lanes: string[] }

/**
 * Workbook vendor block, same sign as the sheet: SHORT PO = PENDING - scheduled.
 * Negative: the schedule asks this vendor for more than its open POs cover (toRaise = that gap).
 * Positive: PO quantity still open with the vendor that is not scheduled for delivery yet.
 */
export function vendorPositions(args: {
  laneIds: string[]
  laneVendors: Record<string, string>
  scheduledByItem: Record<string, number>
  openPo: Record<string, OpenPoBalance>
  vendorName: (id: string) => string
}): VendorPosition[] {
  const rows = new Map<string, VendorPosition>()
  const ensure = (vendorId: string, name: string) => {
    const existing = rows.get(vendorId)
    if (existing) return existing
    const row: VendorPosition = { vendorId, vendorName: name, scheduled: 0, pendingPo: 0, shortPo: 0, toRaise: 0, lanes: [] }
    rows.set(vendorId, row)
    return row
  }
  for (const itemId of args.laneIds) {
    const scheduled = args.scheduledByItem[itemId] || 0
    const vendorId = args.laneVendors[itemId] || "unassigned"
    if (scheduled <= 0 && vendorId === "unassigned") continue
    const row = ensure(vendorId, vendorId === "unassigned" ? "No vendor assigned" : args.vendorName(vendorId))
    row.scheduled = round3(row.scheduled + scheduled)
    row.lanes.push(itemId)
  }
  for (const balance of Object.values(args.openPo)) {
    const row = ensure(balance.supplierId, balance.supplierName || args.vendorName(balance.supplierId))
    row.pendingPo = round3(row.pendingPo + balance.qty)
  }
  const out = Array.from(rows.values()).map((row) => {
    const shortPo = round3(row.pendingPo - row.scheduled)
    return { ...row, shortPo, toRaise: Math.max(0, -shortPo) }
  })
  return out.sort((a, b) => (a.vendorId === "unassigned" ? 1 : 0) - (b.vendorId === "unassigned" ? 1 : 0) || b.scheduled - a.scheduled || a.vendorName.localeCompare(b.vendorName))
}

/** Workbook "VEHI": deliveries (one lane arrival = one vehicle) per day. */
export function vehiclesPerDay(days: string[], laneIds: string[], qtyAt: (day: string, itemId: string) => number): Record<string, number> {
  const out: Record<string, number> = {}
  for (const day of days) out[day] = laneIds.filter((itemId) => qtyAt(day, itemId) > 0).length
  return out
}

export function toDisplay(value: number, unit: "KG" | "MT" | "PCS" | "L"): number {
  return unit === "MT" ? value / 1000 : value
}

export function fromDisplay(value: number, unit: "KG" | "MT" | "PCS" | "L"): number {
  return unit === "MT" ? Math.round(value * 1000 * 1000) / 1000 : value
}

export function formatQty(value: number, unit: "KG" | "MT" | "PCS" | "L"): string {
  const shown = toDisplay(Number(value || 0), unit)
  return shown.toLocaleString("en-IN", { maximumFractionDigits: unit === "MT" ? 3 : unit === "PCS" ? 0 : 1 })
}

function round3(value: number) {
  return Math.round(Number(value || 0) * 1000) / 1000
}

/** Never treat litres or pieces as kilograms during workbook import. */
export function scheduleImportFactor(source: string, masterUnit: string | undefined): number | null {
  const target = String(masterUnit || "").toUpperCase()
  if (source === "MT" && target === "KG") return 1000
  return ["KG", "L", "PCS"].includes(source) && source === target ? 1 : null
}
