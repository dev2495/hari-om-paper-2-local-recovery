/**
 * Plain text from a PO for the purchase desk: its dated delivery rows and the message the vendor
 * gets with the PDF. No React here, so it is unit-tested directly.
 */
import type { DeskOrder } from "../../../lib/api-rm-calendar"

import { qty, shortDate } from "./format"

export type DeliveryRow = {
  id: string
  line_id: string
  item_code: string
  item_name: string
  uom: string
  date: string
  promised_date: string | null
  qty: number
  received: number
  open: number
  confirmation: string
  from_calendar: boolean
  history: any[]
}

export function deliveryRows(order: DeskOrder): DeliveryRow[] {
  const rows: DeliveryRow[] = []
  for (const line of order.lines || []) {
    for (const schedule of (line as any).schedules || []) {
      rows.push({
        id: schedule.id, line_id: line.id, item_code: line.item_code, item_name: line.item_name, uom: line.uom,
        date: schedule.current_date, promised_date: schedule.promised_date, qty: Number(schedule.scheduled_qty || 0) - Number(schedule.cancelled_qty || 0),
        received: Number(schedule.allocated_qty || 0), open: Number(schedule.open_qty ?? 0), confirmation: schedule.confirmation_status,
        from_calendar: Boolean(schedule.from_calendar), history: schedule.change_history || [],
      })
    }
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date) || a.item_code.localeCompare(b.item_code))
}

export function vendorPhone(raw?: string | null): string {
  const digits = String(raw || "").split("/")[0].replace(/\D/g, "")
  if (digits.length === 10) return `91${digits}`
  if (digits.length === 11 && digits.startsWith("0")) return `91${digits.slice(1)}`
  return digits.length >= 11 ? digits : ""
}

export function vendorMessage(order: DeskOrder): string {
  const rows = deliveryRows(order).filter((row) => row.open > 0)
  const lines = (order.lines || []).map((line) => `${line.item_code} ${qty(line.qty_ordered, line.uom)}`).join(", ")
  const dates = rows.map((row) => `${shortDate(row.date)}: ${row.item_code} ${qty(row.open, row.uom)}`).join("; ")
  return `Purchase order ${order.po_no} (revision ${order.current_revision_no}) from Amigo Industries Unit-2 to ${order.supplier_name}. ${lines}.${dates ? ` Delivery: ${dates}.` : ""} Please confirm the dates. The PO PDF is attached.`
}

/** May this login approve or reject the PO's waiting revision? Same rule as the server. */
export function canDecideOrder(order: Pick<DeskOrder, "revision_makers" | "owner_may_decide_own">, me?: string | null): boolean {
  if (order.owner_may_decide_own) return true
  const mine = String(me || "").trim().toLowerCase()
  return !mine || !(order.revision_makers || []).some((maker) => maker.trim().toLowerCase() === mine)
}
