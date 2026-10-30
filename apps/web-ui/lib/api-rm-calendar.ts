/**
 * RM inward calendar and purchase-desk API (spec 3, client 2026-10-28).
 *
 * The calendar read model comes from the BFF (/api/purchase/schedule/calendar): forward need, stock,
 * QC pending and arrivals per material, day by day, in each item's own unit. Arrivals are proposed by
 * the desk, approved by the Owner into DRAFT POs (one per vendor per week), sent to the vendor,
 * confirmed, then received through GRN.
 */
import { api, downloadUrl } from "@/lib/api"
import type { PurchaseOrder } from "@/lib/procurement-types"

export type MaterialClass = "PAPER" | "CHEMICAL" | "PACKING"
export type ArrivalState = "PROPOSED" | "APPROVED" | "ON_PO" | "SENT" | "CONFIRMED" | "RECEIVED" | "CANCELLED" | "REJECTED"

export type Arrival = {
  id: string
  kind: "ENTRY" | "PO_ROW" | "PO_OPEN"
  entry_id: string | null
  schedule_id: string | null
  item_id: string
  po_id: string | null
  po_no: string | null
  po_status: string | null
  po_source?: string | null
  po_line_id: string | null
  date: string
  shown_date: string
  promised_date?: string | null
  /** The row's planned day; a received row shows on its GRN day (``received_on``) instead. */
  planned_date?: string | null
  received_on?: string | null
  qty: number
  received_qty: number
  open_qty: number
  counted_qty: number
  state: ArrivalState
  state_label: string
  overdue: boolean
  no_date?: boolean
  confirmation: string | null
  sent_at: string | null
  sent_channel: string | null
  rate: number | null
  rate_source?: "VENDOR_LAST_PO" | "RM_COSTING" | "RATE_NEEDED" | null
  rate_needed: boolean
  /** A proposal nobody approved by its date: shown on today, goes on today when approved. */
  late_proposal?: boolean
  movable: boolean
  supplier_id: string | null
  supplier_name: string | null
  note: string | null
  source: "MANUAL" | "SUGGESTED" | "PO" | string
  approval_status: string | null
  proposed_by: string | null
  proposed_at: string | null
  approved_by: string | null
  approved_at: string | null
  schedule_version?: number
}

export type NeedRow = {
  date: string
  due_date: string | null
  qty: number
  late: boolean
  order_no: string | null
  job_card_no: string | null
  job_id: string | null
  source: string | null
  made_pcs?: number | null
  planned_pcs?: number | null
  /** The card's first slot on the planner, when it has one. */
  production_plan_date?: string | null
  /** The order line's own due date (customer call-off or line date), never the planner slot. */
  order_due_date?: string | null
  /** The order line has no delivery date: counted from today, shown as "no delivery date". */
  no_date?: boolean
}

export type Shortage = { date: string; qty: number; kind: "BELOW_ZERO" | "BELOW_MIN"; balance: number }

export type CalendarMaterial = {
  item_id: string
  item_code: string
  item_name: string
  item_type: string
  material_class: MaterialClass
  uom: string
  stock_now: number
  qc_pending: number
  qc_counts_from: string
  /** Held stock that is not waiting for incoming QC (failed, held, count gains on hold): never cover. */
  other_held?: number
  min_stock: number | null
  policy: { min_stock: number; lead_time_days: number; minimum_order: number; order_multiple: number } | null
  last_vendor: { supplier_id: string; supplier_name: string; rate: number; po_no: string } | null
  rate: { rate: number; source: "VENDOR_LAST_PO" | "RM_COSTING" | "RATE_NEEDED" } | null
  need: number[]
  late_need: number[]
  /** Counted arrivals per day (Owner-approved and open PO rows). Never includes stock in QC. */
  arrive: number[]
  /** Stock waiting for incoming QC, on the day it starts to count. */
  qc_in: number[]
  proposed: number[]
  balance: number[]
  balance_with_proposals: number[]
  first_short: Shortage | null
  short_after_proposals: Shortage | null
  days_of_cover: number | null
  totals: { need: number; late: number; arriving: number; proposed: number }
  arrivals: Arrival[]
  needs: NeedRow[]
}

export type PendingArrival = {
  entry_id: string
  item_id: string
  item_code: string
  item_name: string
  uom: string
  material_class: MaterialClass
  date: string
  qty: number
  late?: boolean
  supplier_id: string | null
  supplier_name: string | null
  rate?: number | null
  rate_source?: "VENDOR_LAST_PO" | "RM_COSTING" | "RATE_NEEDED" | null
  value?: number | null
  note?: string | null
  proposed_by?: string | null
  /** Dated after the window on screen: counted here, drawn only in a longer window. */
  outside_window?: boolean
}

export type CalendarData = {
  plant_id: string
  weeks: number
  today: string
  start: string
  end: string
  days: string[]
  qc_days: number
  materials: CalendarMaterial[]
  unmapped: Array<{ key: string; code: string; name: string; material_class: string; uom: string; qty: number; order_nos: string[] }>
  warnings: Array<{ order_no?: string | null; reason: string; not_counted?: boolean }>
  pending_approval: { count: number; entries: PendingArrival[]; qty_by_uom: Record<string, number>; vendors: string[] }
  source_version: string
}

export type Suggestion = {
  item_id: string
  item_code: string
  item_name: string
  uom: string
  material_class: MaterialClass
  entry_date: string
  qty: number
  short_date: string
  short_qty: number
  supplier_id: string | null
  supplier_name: string | null
  order_by: string | null
  late_to_order: boolean
  reason: string
}

export type ArrivalInput = {
  item_id: string
  entry_date: string
  qty: number
  supplier_id?: string | null
  supplier_name?: string | null
  note?: string | null
  source?: "MANUAL" | "SUGGESTED"
}

export type ApproveResult = {
  approved: string[]
  already: string[]
  skipped: Array<{ id: string; reason: string }>
  purchase_orders: Array<{ id: string; po_no: string; supplier_name: string; status: string; schedule_week: string | null; week_label: string | null; lines: number; rate_needed: boolean }>
  idempotent: boolean
}

export type SendCheck = {
  mode: "SEND_ON_SCHEDULE" | "SUBMIT_FOR_APPROVAL" | "WAITING_APPROVAL" | "SEND" | "CLOSED"
  unchanged_since_owner_approval: boolean
  rate_needed: string[]
  /** Material names with no rate (for words; ``rate_needed`` keeps the codes). */
  rate_needed_names?: string[]
  /** What changed since the Owner approved the arrivals, one plain sentence each. */
  changes?: string[]
  reasons: string[]
}

export type DeskOrder = PurchaseOrder & {
  source?: string
  scheduled_by?: string | null
  scheduled_at?: string | null
  schedule_week?: string | null
  approved_by?: string | null
  approved_at?: string | null
  approval_source?: "OWNER" | "SCHEDULE" | null
  submitted_by?: string | null
  sent_at?: string | null
  sent_by?: string | null
  sent_channel?: "WHATSAPP" | "EMAIL" | "PDF" | "PRINT" | null
  vendor_confirmed_at?: string | null
  vendor_confirmed_by?: string | null
  send_check?: SendCheck
  metadata_json?: Record<string, any>
  /** Who prepared / submitted the revision waiting for the Owner (maker-checker). */
  revision_makers?: string[]
  /** Scheduled POs are the Owner's own decision: he may decide a revision he made or submitted. */
  owner_may_decide_own?: boolean
}


export type QueueKey = "scheduled" | "waiting" | "returned" | "unsent" | "sent" | "all"
export type SendChannel = "WHATSAPP" | "EMAIL" | "PDF" | "PRINT"

export type ExpectedArrival = Arrival & { bucket: "OVERDUE" | "TODAY" | "THIS_WEEK" | "LATER"; item_code: string; item_name: string; uom: string }

export const rmCalendarApi = {
  calendar: (weeks: number) => api.get<CalendarData>("/api/purchase/schedule/calendar", { params: { weeks } }),
  suggest: (body: { weeks: number; material_class?: string; item_ids?: string[] }) => api.post<{ weeks: number; items: Suggestion[] }>("/api/purchase/schedule/suggest", body),
  propose: (entries: ArrivalInput[]) => api.post("/api/purchase/schedule/entries", { entries }),
  update: (id: string, body: Partial<ArrivalInput> & { confirm_po_change?: boolean }) => api.patch(`/api/purchase/schedule/entries/${id}`, body),
  cancel: (id: string, reason?: string) => api.post(`/api/purchase/schedule/entries/${id}/cancel`, { reason: reason || null }),
  approve: (entryIds: string[], supplierIds: string[]) =>
    api.post<ApproveResult>("/api/purchase/schedule/approve", { request_id: crypto.randomUUID(), entry_ids: entryIds, supplier_ids: supplierIds }),
  supply: (start: string, end: string) => api.get<{ today: string; items: Array<{ item_id: string; item_code: string; item_name: string; uom: string }>; arrivals: Arrival[] }>("/api/purchase/schedule/supply", { params: { start, end } }),
  expectedArrivals: () => api.get<{ today: string; items: ExpectedArrival[] }>("/api/purchase/schedule/expected-arrivals"),
  queue: (params: { queue?: QueueKey; q?: string; limit?: number; offset?: number; status?: string }) =>
    api.get<{ items: DeskOrder[]; total: number; summary: { awaiting_approval: number; receivable: number; open_by_uom: Record<string, number>; queues: Record<string, number> } }>("/api/purchase/orders", { params }),
  send: (poId: string, body: { expected_version: number; channel: SendChannel; note?: string }) => api.post<DeskOrder>(`/api/purchase/orders/${poId}/send`, body),
  vendorConfirm: (poId: string, body: { expected_version: number; rows: Array<{ schedule_id: string; confirmed_date?: string }>; note?: string }) =>
    api.post<DeskOrder>(`/api/purchase/orders/${poId}/vendor-confirm`, body),
  /** The saved PO PDF as a file, for WhatsApp share / email attachment / download. */
  pdfFile: async (order: { id: string; po_no: string; current_revision_no: number }) => {
    const response = await api.get(`/api/purchase/orders/${order.id}/pdf`, { params: { revision_no: order.current_revision_no }, responseType: "blob" })
    const name = `${order.po_no.replace(/\//g, "-")}-R${order.current_revision_no}.pdf`
    return new File([response.data as Blob], name, { type: "application/pdf" })
  },
  pdfUrl: (order: { id: string; current_revision_no: number }) => downloadUrl(`/api/purchase/orders/${order.id}/pdf?revision_no=${order.current_revision_no}`),
}

/** Plain text of an API error (FastAPI detail may be a string, an object or a list). */
export function apiErrorText(error: any): string {
  const detail = error?.response?.data?.detail
  if (typeof detail === "string") return detail
  if (detail && typeof detail === "object" && !Array.isArray(detail)) return String(detail.message || detail.detail || "The request failed")
  if (Array.isArray(detail)) return detail.map((row: any) => row?.msg).filter(Boolean).join("; ") || "Check the values and try again"
  return error?.message || "The request failed. Try again."
}
