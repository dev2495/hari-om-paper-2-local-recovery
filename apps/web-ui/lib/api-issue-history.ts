import { api } from "@/lib/api"

/**
 * Issue history (client 2026-10-30): every issue to the floor — reels and coils, parchment by kg, adhesive /
 * packing lots and older issue-to-job-card moves — with its business date and shift (the shift rule: A 08–20,
 * B 20–08 IST, the day the shift began), registration time, who issued it and the rack it was picked from.
 */

export type IssueHistoryRow = {
  id: string
  source: "REEL_ISSUE" | "MATERIAL_ISSUE" | "WIP_ISSUE"
  kind: "REEL" | "MATERIAL"
  /** Business date, YYYY-MM-DD. */
  day: string | null
  /** Registration time, naive UTC ISO. */
  issued_at: string | null
  shift: string | null
  shift_label: string
  item_id: string
  item_code: string
  item_name: string
  item_type: string
  lot: string | null
  lot_kind: "Reel" | "Coil" | "Lot"
  vendor_reel_no: string | null
  qty: number
  uom: string
  to: string
  card: string | null
  card_label: string | null
  issued_by: string | null
  from_location: { id: string; code: string; name: string } | null
  note: string | null
  plant_id: string
}

export type IssueHistory = {
  date_from: string
  date_to: string
  today: string
  count: number
  truncated: boolean
  totals: Array<{ uom: string; unit: string; qty: number; count: number }>
  people: string[]
  rows: IssueHistoryRow[]
}

export type IssueHistoryFilters = {
  date_from?: string
  date_to?: string
  shift?: string
  item?: string
  card?: string
  person?: string
  kind?: "ALL" | "REEL" | "MATERIAL"
}

export const issueHistoryApi = {
  list: async (filters: IssueHistoryFilters): Promise<IssueHistory> => {
    const params = Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== undefined && value !== "" && value !== "ALL"))
    const { data } = await api.get("/api/inventory/issue-history", { params })
    return data
  },
}

/** CSV cells: quoted, with formula-looking text defused (a value starting = + - @ is prefixed with '). */
export function csvCell(value: unknown): string {
  let text = value == null ? "" : String(value)
  if (/^[=+\-@]/.test(text)) text = `'${text}`
  return `"${text.replaceAll('"', '""')}"`
}
