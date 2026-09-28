import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query"

import { productionApi, salesApi } from "@/lib/api"

export type LifecycleState = "QUEUED" | "SCHEDULED" | "RUNNING" | "COMPLETED" | "FORCE_CLOSED" | "CANCELLED"

export type JobCardLifecycle = {
  id: string
  job_card_no: string | null
  state: LifecycleState
  status: string
  current_stage: string
  first_stage: string
  anchor_stage: string
  parchment_color: string | null
  is_emergency: boolean
  planned_qty: number
  released_qty: number
  made_qty: number
  made_in_anchor_unit: number
  pcs_per_bamboo: number | null
  open_first_stage_qty: number
  returned_qty: number
  output_tolerance_pct: number
  max_output_qty: number
  close_mode: string | null
  missed_slot_count: number
  missed_slot_open: boolean
  last_missed_slot: { stage?: string; machine_id?: string | null; plan_date?: string; shift_code?: string | null; requeued_at?: string } | null
  close_reason: string | null
  closed_at: string | null
  closed_by: string | null
  actions: { edit: boolean; split: boolean; force_close: boolean; emergency: boolean; running_entry: boolean }
  stages: Array<{
    stage: string
    unit: "bamboo" | "pcs"
    planned_in_unit: number
    status: string
    planned_qty: number
    output_qty: number
    running_total: number
    running_entries: Array<{ at: string; date: string; shift: string | null; qty: number; scrap: number; by: string; note?: string | null }>
    segments: Array<{ id: string; status: string; planned_qty: number; output_qty: number; machine_id: string | null; plan_date: string | null; shift_code: string | null; sequence_no: number }>
  }>
  family: Array<{ id: string; job_card_no: string | null; split_kind: string | null; planned_qty: number; status: string; close_mode: string | null; is_self: boolean }>
  events: Array<{ id: string; action: string; actor: string | null; role: string | null; at: string; payload: Record<string, any> }>
  sales_order_id: string
  sales_order_line_id: string | null
  release_lot_id: string | null
}

export function invalidateJobCardViews(queryClient: QueryClient) {
  for (const key of ["job-card-lifecycle", "planning-board", "planning-queue", "planning-job-cards", "planning-job-card", "job-card-aggregates", "winder-load", "sales-orders", "sales-order", "analytics-production-live-wip"]) {
    queryClient.invalidateQueries({ queryKey: [key] })
  }
}

export function useJobCardLifecycle(jobCardId?: string | null) {
  return useQuery({
    queryKey: ["job-card-lifecycle", jobCardId],
    queryFn: async () => (await productionApi.getJobCardLifecycle(String(jobCardId))).data as JobCardLifecycle,
    enabled: Boolean(jobCardId),
  })
}

export type WinderLoadRow = {
  machine_id: string
  queued_pcs: number; scheduled_pcs: number; running_pcs: number; open_pcs: number
  queued_m: number; scheduled_m: number; running_m: number; open_m: number
  capacity_m_per_day: number | null
  days_of_work: number | null
  cards: number
  by_day: Array<{ date: string; pcs: number; m: number }>
}

export function useWinderLoad(enabled = true) {
  return useQuery({
    queryKey: ["winder-load"],
    queryFn: async () => (await productionApi.getWinderLoad()).data as {
      as_of: string
      machines: WinderLoadRow[]
    },
    enabled,
    staleTime: 30_000,
  })
}

function lifecycleMutation<TVars>(fn: (vars: TVars) => Promise<any>) {
  return function useIt() {
    const queryClient = useQueryClient()
    return useMutation({
      mutationFn: fn,
      onSuccess: () => invalidateJobCardViews(queryClient),
    })
  }
}

export const useAmendJobCard = lifecycleMutation(({ jobCardId, data }: { jobCardId: string; data: Parameters<typeof productionApi.amendJobCard>[1] }) =>
  productionApi.amendJobCard(jobCardId, data),
)
export const useSplitJobCard = lifecycleMutation(({ jobCardId, qty, reason, requestId }: { jobCardId: string; qty: number; reason?: string; requestId?: string }) =>
  productionApi.splitJobCard(jobCardId, { qty, reason, request_id: requestId }),
)
export const useForceCloseJobCard = lifecycleMutation(({ jobCardId, reason }: { jobCardId: string; reason: string }) =>
  productionApi.forceCloseJobCard(jobCardId, { reason }),
)
export const useRunningEntry = lifecycleMutation(({ jobCardId, data }: { jobCardId: string; data: any }) => productionApi.postRunningEntry(jobCardId, data))
export const useEmergencyInsert = lifecycleMutation((data: Parameters<typeof productionApi.emergencyInsert>[0]) => productionApi.emergencyInsert(data))
export const useUpdateLineColors = lifecycleMutation(({ lineId, colorSplits }: { lineId: string; colorSplits: Array<{ color: string; color_id?: string | null; qty: number }> }) =>
  salesApi.updateLineColors(lineId, colorSplits),
)

export function apiErrorText(error: any, fallback = "Something went wrong") {
  const detail = error?.response?.data?.detail
  if (typeof detail === "string") return detail
  if (detail?.message) return String(detail.message)
  if (Array.isArray(detail)) return detail.map((row: any) => row?.msg || String(row)).join("; ")
  return error?.message || fallback
}

/** Run the 36h missed-slot sweep when a planning view opens (at most every 10 min per tab). */
export function useMissedSlotSweep(enabled = true) {
  const queryClient = useQueryClient()
  return useQuery({
    queryKey: ["missed-slot-sweep"],
    queryFn: async () => {
      const { data } = await productionApi.sweepMissedSlots()
      if (Array.isArray(data?.requeued) && data.requeued.length) invalidateJobCardViews(queryClient)
      return data as { requeued: any[] }
    },
    enabled,
    staleTime: 10 * 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  })
}

export function useMissedSlots(includeResolved = false) {
  return useQuery({
    queryKey: ["missed-slots", includeResolved],
    queryFn: async () => (await productionApi.getMissedSlots({ include_resolved: includeResolved })).data as any[],
    staleTime: 60_000,
  })
}

/**
 * Request id for a write that must not happen twice: kept until the server answers, so pressing
 * the button again after a lost response replays the first request instead of repeating it.
 */
export function newRequestId() {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `req-${Date.now()}-${Math.random().toString(36).slice(2)}`
}
