/**
 * Gate module API (6 Nov 2026): /api/gate/* (signed in) and /api/public/visit/* (the visitor's phone, no login).
 * Not re-exported from lib/api.ts (keeps the shared file small); import from here.
 */
import { api, downloadUrl } from "@/lib/api"
import type { VaultDocument } from "@/lib/api-documents"

export type GateDirection = "IN" | "OUT" | "BOTH"
export type Gate = {
  id: string; plant_id: string; code: string; name: string; direction: GateDirection; active: boolean; version: number
  token_rotated_at: string | null; token_rotated_by: string | null; created_at: string | null
  qr_token?: string; public_path?: string
}
export type GateSettings = { plant_id: string; gate_close_time: string; visitor_retention_days: number; version: number; defaults: { gate_close_time: string; visitor_retention_days: number } }

export type EntryStatus = "AT_GATE" | "WITH_STORES" | "WITH_ACCOUNTS" | "LINKED" | "FILED" | "OUT" | "VOID"
export type GateEntry = {
  id: string; entry_no: string; plant_id: string; kind: "BILL_IN" | "GOODS_OUT"; direction: "IN" | "OUT"
  gate_id: string | null; gate_name: string | null; category_code: string | null; category_label: string | null
  route: "STORES" | "ACCOUNTS" | "DISPATCH"; status: EntryStatus; status_label: string
  vehicle_no: string | null; party_id: string | null; party_text: string | null; note: string | null
  receipt_id: string | null; grn_no: string | null; dispatch_ref: string | null
  bill_no: string | null; bill_date: string | null; bill_amount: number | null; cost_head_code: string | null; cost_head_label: string | null
  filed_by: string | null; filed_at: string | null; linked_by: string | null; linked_at: string | null
  created_by: string; created_at: string | null; version: number; documents: VaultDocument[]; document_count: number
  history: Array<{ at: string; by: string; action: string; [key: string]: any }>; waiting_hours: number | null
  /** Goods out: which of the two photos (Tally bill, challan) are not in the vault yet. The truck is never held for it. */
  photos_missing?: string[]
  /** Every saved photo of the entry, also those this login may not open. */
  photo_count?: number
}

export type VisitStatus = "ARRIVED" | "IN" | "OUT" | "DENIED" | "NO_SHOW"
export type HostReply = "SEND_IN" | "WAIT" | "NOT_AVAILABLE"
export type GateVisit = {
  id: string; visit_no: string; status: VisitStatus; status_label: string; gate_id: string; gate_name: string | null
  visitor_name: string; company: string | null; purpose_code: string; purpose_label: string; purpose_note: string | null
  host_user_id: string | null; host_name: string | null; host_department: string | null; host_words: string
  people: number; vehicle_no: string | null; source: "SELF" | "DESK"
  arrived_at: string | null; in_at: string | null; in_by: string | null; out_at: string | null; out_by: string | null
  denied_by: string | null; deny_code: string | null; deny_label: string | null; deny_note: string | null
  host_reply: HostReply | null; host_reply_label: string | null; host_reply_by: string | null; host_reply_at: string | null
  version: number; created_by: string; visits_count: number | null; overstay: boolean; has_photo: boolean
  mobile: string | null; photo_url: string | null
}

export type LeavingRow = {
  dispatch_ref: string; items: Array<{ item_code: string; item_name: string; uom: string; qty: number }>; qty_total: number
  posted_at: string | null; posted_day: string | null; carried_over: boolean; job_card_ids: string[]
  tally_bill_no: string | null; tally_bill_date: string | null; vehicle_no: string | null; out: boolean; out_at: string | null; gate_entry_id: string | null
}

export type GateDesk = {
  gate: Gate; settings: GateSettings
  counts: { waiting: number; inside: number; people_inside: number; overstay: number; bills_today: number; vehicles_today: number; leaving: number; out_today: number }
  waiting: GateVisit[]; inside: GateVisit[]; vehicles: GateEntry[]
  today: { entries: GateEntry[]; visits: GateVisit[] }
  /** Goods out today still waiting for a photo upload (Tally bill / challan). */
  photos_pending?: Array<{ entry_id: string; entry_no: string; dispatch_ref: string | null; missing: string[] }>
  server_time: string
}

export type Host = { id: string; name: string; department: string | null; department_key: string | null }
export type HostList = { items: Host[]; departments: Array<{ key: string; label: string }> }
export type DispatchGateStatus = { tally_bill_no: string | null; tally_bill_date: string | null; out: boolean; out_at: string | null; vehicle_no: string | null; version: number; gate_entry_id: string | null; photos_missing?: string[] }

export type HistoryRow = {
  type: "VISITOR" | "BILL_IN" | "GOODS_OUT"; type_label: string; id: string; no: string; at: string | null; gate: string | null
  status: string; status_label: string; name: string | null; company: string | null; mobile: string | null; vehicle_no: string | null
  detail: string | null; host: string | null; people: number | null; in_at: string | null; out_at: string | null; reference: string; by: string | null; amount?: number | null; photos_missing?: string[]
}
export type HistoryFilters = { date_from?: string; date_to?: string; gate_id?: string; type?: string; status?: string; q?: string; limit?: number; offset?: number }

export type VisitForm = {
  request_id: string; mobile: string; name: string; company?: string; purpose_code: string; purpose_note?: string
  people: number; vehicle_no?: string; host_user_id?: string | null; host_department_key?: string | null
}

const clean = (params: Record<string, any>) => Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== ""))

export const gateApi = {
  gates: (includeInactive = false) => api.get<{ items: Gate[] }>("/api/gate/gates", { params: { include_inactive: includeInactive } }).then((r) => r.data.items),
  createGate: (body: { code: string; name: string; direction: GateDirection }) => api.post<Gate>("/api/gate/gates", body).then((r) => r.data),
  updateGate: (id: string, body: { expected_version: number; name?: string; direction?: GateDirection; active?: boolean }) => api.patch<Gate>(`/api/gate/gates/${id}`, body).then((r) => r.data),
  rotateToken: (id: string, expected_version: number) => api.post<Gate>(`/api/gate/gates/${id}/rotate-token`, { expected_version }).then((r) => r.data),
  settings: () => api.get<GateSettings>("/api/gate/settings").then((r) => r.data),
  saveSettings: (body: { gate_close_time: string; visitor_retention_days: number; expected_version: number }) => api.put<GateSettings>("/api/gate/settings", body).then((r) => r.data),

  desk: (gateId: string) => api.get<GateDesk>("/api/gate/desk", { params: { gate_id: gateId } }).then((r) => r.data),
  leavingToday: () => api.get<{ items: LeavingRow[] }>("/api/gate/leaving-today").then((r) => r.data.items),
  vendors: (q?: string) => api.get<{ items: Array<{ id: string; name: string }> }>("/api/gate/vendors", { params: clean({ q }) }).then((r) => r.data.items),
  hosts: (q?: string) => api.get<HostList>("/api/gate/hosts", { params: clean({ q }) }).then((r) => r.data),

  billIn: (body: { request_id: string; gate_id: string; category_code: string; vendor_id?: string; vendor_name?: string; vehicle_no?: string; note?: string }) =>
    api.post<{ created: boolean; entry: GateEntry; document_kind?: string }>("/api/gate/entries", body).then((r) => r.data),
  entry: (id: string) => api.get<GateEntry>(`/api/gate/entries/${id}`).then((r) => r.data),
  recategorise: (id: string, body: { category_code: string; category_note?: string; expected_version: number }) => api.post<GateEntry>(`/api/gate/entries/${id}/category`, body).then((r) => r.data),
  atTheGate: () => api.get<{ items: GateEntry[] }>("/api/gate/at-the-gate").then((r) => r.data.items),
  linkReceipt: (id: string, body: { receipt_id: string; expected_version?: number }) => api.post<GateEntry>(`/api/gate/entries/${id}/link-receipt`, body).then((r) => r.data),
  receiptEntries: (receiptIds: string[]) => api.get<{ items: Record<string, Array<{ id: string; entry_no: string; linked_at: string | null }>> }>("/api/gate/receipt-entries", { params: { receipt_ids: receiptIds.join(",") } }).then((r) => r.data.items),
  bills: (tab: "TO_FILE" | "FILED" | "ALL", q?: string) => api.get<{ items: GateEntry[]; counts: { TO_FILE: number; FILED: number } }>("/api/gate/bills", { params: clean({ tab, q }) }).then((r) => r.data),
  fileBill: (id: string, body: { expected_version: number; party_name: string; bill_no: string; bill_date: string; amount: string; cost_head_code: string; cost_head_note?: string }) =>
    api.post<GateEntry>(`/api/gate/entries/${id}/file`, body).then((r) => r.data),

  walkIn: (body: VisitForm & { gate_id: string; let_in?: boolean }) => api.post<{ created: boolean; visit: GateVisit; pass_code: string }>("/api/gate/visits", body).then((r) => r.data),
  letIn: (id: string, expected_version?: number) => api.post<GateVisit>(`/api/gate/visits/${id}/in`, { expected_version }).then((r) => r.data),
  deny: (id: string, body: { reason_code: string; reason_note?: string; expected_version?: number }) => api.post<GateVisit>(`/api/gate/visits/${id}/deny`, body).then((r) => r.data),
  out: (id: string) => api.post<GateVisit>(`/api/gate/visits/${id}/out`, {}).then((r) => r.data),
  scanOut: (code: string) => api.post<{ action: "OUT" | "WAITING"; visit: GateVisit }>("/api/gate/visits/scan-out", { code }).then((r) => r.data),
  setVisitPhoto: (id: string, documentId: string) => api.post<GateVisit>(`/api/gate/visits/${id}/photo`, { document_id: documentId }).then((r) => r.data),

  goodsOut: (body: { request_id: string; gate_id: string; dispatch_ref: string; tally_bill_no: string; tally_bill_date?: string; vehicle_no?: string }) =>
    api.post<{ created: boolean; entry: GateEntry; dispatch: DispatchGateStatus }>("/api/gate/goods-out", body).then((r) => r.data),
  dispatchStatus: (refs: string[]) => api.get<{ items: Record<string, DispatchGateStatus> }>("/api/gate/dispatch-status", { params: { refs: refs.join(",") } }).then((r) => r.data.items),
  setTally: (body: { dispatch_ref: string; tally_bill_no: string; tally_bill_date?: string; expected_version?: number }) => api.put<DispatchGateStatus>("/api/gate/dispatch/tally", body).then((r) => r.data),

  history: (filters: HistoryFilters) => api.get<{ items: HistoryRow[]; total: number; counts: Record<string, number>; date_from: string; date_to: string; truncated: boolean }>("/api/gate/history", { params: clean(filters as any) }).then((r) => r.data),
  historyCsvUrl: (filters: HistoryFilters) => downloadUrl(`/api/gate/history/export.csv?${new URLSearchParams(clean({ ...filters, limit: undefined, offset: undefined }) as any).toString()}`),
}

/** The visitor's phone: plain fetch, no session, no plant header. */
async function publicCall<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/public/visit/${path}`, { cache: "no-store", credentials: "omit", ...init })
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    const detail = data && typeof data.detail === "string" ? data.detail : response.status === 429 ? "Too many tries. Wait a minute and try again." : "Something went wrong. Try again, or speak to the watchman at the gate."
    const error = new Error(detail) as Error & { status?: number }
    error.status = response.status
    throw error
  }
  return data as T
}

export type PublicPass = {
  visit_no: string; status: VisitStatus; status_label: string; visitor_name: string; company: string | null; purpose_label: string
  host_words: string; people: number; gate_name: string | null; arrived_at: string | null; in_at: string | null; out_at: string | null
  host_reply: HostReply | null; host_reply_label: string | null; deny_label: string | null; has_photo: boolean; photo_allowed: boolean; pass_code: string
}

export const publicVisitApi = {
  form: (token: string) => publicCall<{ gate_name: string; purposes: Array<{ code: string; label: string }> }>(encodeURIComponent(token)),
  hosts: (token: string, q: string) => publicCall<HostList>(`${encodeURIComponent(token)}/hosts?q=${encodeURIComponent(q)}`),
  lookup: (token: string, mobile: string) => publicCall<{ known: boolean; name?: string | null; company?: string | null }>(`${encodeURIComponent(token)}/lookup`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mobile }),
  }),
  checkIn: (token: string, body: VisitForm) => publicCall<{ created: boolean; pass_token: string; pass: PublicPass }>(encodeURIComponent(token), {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }),
  pass: (passToken: string) => publicCall<PublicPass>(`pass/${encodeURIComponent(passToken)}`),
  photo: (passToken: string, blob: Blob) => {
    const form = new FormData()
    form.append("file", blob, "visitor.jpg")
    return publicCall<PublicPass>(`pass/${encodeURIComponent(passToken)}/photo`, { method: "POST", body: form })
  },
}

export { dispatchRefFromScan, isMobile, mobileDigits, passTokenFromScan } from "@/lib/gate-scan"

export const MATERIAL_CATEGORY = "GB-MATERIAL"
export const GATE_STORAGE_KEY = "hariom_gate_id_v1"
