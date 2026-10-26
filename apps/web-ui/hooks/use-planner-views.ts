import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { productionApi } from "@/lib/api"

/** A saved planner queue view as the server returns it (filters are opaque JSON, see lib/planner-queue-filters). */
export type PlannerView = {
  id: string
  name: string
  scope: "PERSONAL" | "PLANT"
  stage: string | null
  filters: Record<string, unknown>
  position: number
  owner_name?: string | null
  mine: boolean
  can_edit: boolean
  updated_at?: string | null
}

export type PlannerViewPayload = {
  name: string
  scope: "PERSONAL" | "PLANT"
  stage: string | null
  filters: Record<string, unknown>
  position?: number
}

const VIEWS_KEY = ["planner-views"]

export function usePlannerViews(stage: string, plantId?: string, enabled = true) {
  return useQuery({
    queryKey: [...VIEWS_KEY, plantId || "default", stage],
    queryFn: async () => {
      const { data } = await productionApi.listPlannerViews(stage)
      return (Array.isArray(data) ? data : []) as PlannerView[]
    },
    enabled: enabled && Boolean(stage),
    staleTime: 60_000,
  })
}

function useInvalidateViews() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: VIEWS_KEY })
}

export function useCreatePlannerView() {
  const invalidate = useInvalidateViews()
  return useMutation({
    mutationFn: async (payload: PlannerViewPayload) => (await productionApi.createPlannerView(payload)).data as PlannerView,
    onSuccess: invalidate,
  })
}

export function useUpdatePlannerView() {
  const invalidate = useInvalidateViews()
  return useMutation({
    mutationFn: async ({ id, ...payload }: PlannerViewPayload & { id: string }) => (await productionApi.updatePlannerView(id, payload)).data as PlannerView,
    onSuccess: invalidate,
  })
}

export function useDeletePlannerView() {
  const invalidate = useInvalidateViews()
  return useMutation({
    mutationFn: async (id: string) => (await productionApi.deletePlannerView(id)).data,
    onSuccess: invalidate,
  })
}

export type BulkMove = {
  job_card_id?: string | null
  segment_id?: string | null
  stage: string
  machine_id: string | null
  sequence_no: number
  plan_date: string | null
  shift_code: string | null
}

/** Several queue cards onto one slot in one call: all or nothing, in the order given. */
export function usePlanningBulkMove() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (moves: BulkMove[]) => productionApi.movePlanningBulk(moves),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["planning-board"] })
      queryClient.invalidateQueries({ queryKey: ["planning-queue"] })
      queryClient.invalidateQueries({ queryKey: ["planning-job-cards"] })
      queryClient.invalidateQueries({ queryKey: ["planning-job-card"] })
      queryClient.invalidateQueries({ queryKey: ["analytics-production-live-wip"] })
    },
  })
}
