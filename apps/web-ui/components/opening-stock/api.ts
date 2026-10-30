"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { useAuth } from "@/context/AuthContext"
import { api } from "@/lib/api"
import type { LotRow, UnitTotal, Uom } from "@/lib/api-stock"

/**
 * Go-live opening stock (client 2026-10-30). Calls go through the BFF under /api/inventory/stock-control/…;
 * the inventory service checks the go-live date rule, the books lock and that only Owner / Admin post.
 */

export type OpeningState = {
  state: "NOT_STARTED" | "OPEN" | "CLOSED"
  go_live_date: string | null
  go_live_label: string | null
  month_label: string | null
  message: string | null
  /** Why opening stock is closed: its month is closed, or the plant's stock book already runs (a closed month). */
  closed_reason?: string | null
}
export type BatchItem = { item_id: string; item_code: string | null; item_name: string | null; uom: Uom; qty: number; reels: number; lots: number; held?: number }
export type OpeningBatch = {
  id: string
  document_no: string
  batch_no: number | null
  effective_date: string
  notes: string | null
  created_by: string
  created_at: string | null
  line_count: number
  reel_count: number
  lot_count: number
  held_count: number
  units: UnitTotal[]
  items: BatchItem[]
  value: number
  source_label: string
  labels?: OpeningLabel[]
  idempotent?: boolean
}
export type OpeningLabel = LotRow & {
  posted_qty: number
  old_mark: string | null
  vendor_name: string | null
  vendor_ref: string | null
  hold_reason: string | null
  rate: number | null
  source_label: string
  qr_value: string
}
export type LocationBrief = { id: string; code: string; name: string; purpose: string | null; active: boolean; is_receiving_default: boolean }
export type OpeningOverview = {
  plant_id: string
  opening: OpeningState
  today: string
  can_post: boolean
  default_location: LocationBrief | null
  batches: OpeningBatch[]
  totals: { batches: number; reels: number; lots: number; held: number; units: UnitTotal[]; value: number }
}
export type OpeningLineInput = {
  item_id: string
  kind: "REEL" | "BULK"
  qty: number
  location_id?: string
  old_mark?: string
  vendor_name?: string
  vendor_ref?: string
  on_hold?: boolean
  hold_reason?: string
  unit_cost?: number
}
export type PreviewLine = Partial<Omit<OpeningLineInput, "qty">> & { qty?: number | null }
export type CheckedLine = {
  index: number
  ok: boolean
  errors: Array<{ field: string; message: string }>
  warnings: string[]
  kind: "REEL" | "BULK"
  item_id: string | null
  item_code: string | null
  item_name: string | null
  uom: Uom
  qty: number
  stock_status: string
  location: LocationBrief | null
  rate: number | null
}
export type OpeningPreview = {
  lines: CheckedLine[]
  error_count: number
  warning_count: number
  totals: { reels: number; lots: number; held: number; units: UnitTotal[]; items: BatchItem[]; items_without_rate: number }
  default_location: LocationBrief | null
  /** warning: the plant already has stock movements before the go-live date the first batch would fix. */
  date: { ok: boolean; effective_date: string | null; message: string | null; warning?: string | null }
  can_post: boolean
  opening: OpeningState
}

const base = "/api/inventory/stock-control"

export const openingApi = {
  overview: async () => (await api.get<OpeningOverview>(`${base}/opening-stock`)).data,
  preview: async (body: { effective_date: string | null; lines: PreviewLine[] }) => (await api.post<OpeningPreview>(`${base}/opening-loads/preview`, body)).data,
  post: async (body: { effective_date: string; request_id: string; notes?: string; lines: OpeningLineInput[] }) => (await api.post<OpeningBatch>(`${base}/opening-loads`, body)).data,
  labels: async (id: string) => (await api.get<OpeningBatch>(`${base}/opening-loads/${encodeURIComponent(id)}/labels`)).data,
}

function usePlant() {
  const { activePlant } = useAuth()
  return { plant: activePlant || "none", single: Boolean(activePlant && activePlant !== "ALL") }
}

export function useOpeningOverview() {
  const { plant, single } = usePlant()
  return useQuery({ queryKey: ["opening-stock", plant, "overview"], queryFn: openingApi.overview, enabled: single })
}

export function useOpeningLabels(id: string) {
  const { plant, single } = usePlant()
  return useQuery({ queryKey: ["opening-stock", plant, "labels", id], queryFn: () => openingApi.labels(id), enabled: single && Boolean(id) })
}

export function usePostOpening() {
  const client = useQueryClient()
  const { plant } = usePlant()
  return useMutation({
    mutationFn: openingApi.post,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["opening-stock", plant] })
      // The stock book, locations and issue desks now hold the new reels and lots.
      void client.invalidateQueries({ queryKey: ["stock", plant] })
      void client.invalidateQueries({ queryKey: ["inventory-opening-loads"] })
    },
  })
}
