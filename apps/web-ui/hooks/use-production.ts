import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { productionApi } from "@/lib/api"

export function useJobCards() {
  return useQuery({
    queryKey: ["job-cards"],
    queryFn: async () => {
      const { data } = await productionApi.getPlanningJobCards()
      return data
    },
  })
}

export function useCreateJobCard() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: any) => productionApi.createPlanningJobCard(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["job-cards"] })
      queryClient.invalidateQueries({ queryKey: ["planning-job-cards"] })
      queryClient.invalidateQueries({ queryKey: ["planning-queue"] })
    },
  })
}

export function useMachines() {
  return useQuery({
    queryKey: ["machines"],
    queryFn: async () => {
      const { data } = await productionApi.getMachines()
      return data
    },
  })
}

export function useJobCardPrint(jobId?: string) {
  return useQuery({
    queryKey: ["job-card-print", jobId],
    queryFn: async () => {
      const { data } = await productionApi.getPlanningJobCard(String(jobId))
      return data
    },
    enabled: !!jobId,
  })
}

export function usePlanningQueue(
  stage: string,
  planDate?: string,
  includeUnscheduled = true,
  plantId?: string,
) {
  return useQuery({
    queryKey: ["planning-queue", stage, planDate || "none", includeUnscheduled, plantId || "default"],
    queryFn: async () => {
      const { data } = await productionApi.getPlanningQueue({
        stage,
        plan_date: planDate,
        include_unscheduled: includeUnscheduled,
        plant_id: plantId,
      })
      return data
    },
    enabled: !!stage,
  })
}

export function usePlanningBoard(
  stage?: string,
  planDate?: string,
  includeUnscheduled = true,
  plantId?: string,
  enabled = true,
) {
  return useQuery({
    queryKey: ["planning-board", stage || "all", planDate || "none", includeUnscheduled, plantId || "default"],
    queryFn: async () => {
      const { data } = await productionApi.getPlanningBoard({
        stage,
        plan_date: planDate,
        include_unscheduled: includeUnscheduled,
        plant_id: plantId,
      })
      return data
    },
    enabled,
  })
}

export function usePlanningJobCards(params?: any, enabled = true) {
  return useQuery({
    queryKey: ["planning-job-cards", params || {}],
    queryFn: async () => {
      const { data } = await productionApi.getPlanningJobCards(params)
      return data
    },
    enabled,
  })
}

export function usePlanningJobCard(jobCardId?: string) {
  return useQuery({
    queryKey: ["planning-job-card", jobCardId],
    queryFn: async () => {
      const { data } = await productionApi.getPlanningJobCard(String(jobCardId))
      return data
    },
    enabled: !!jobCardId,
  })
}

export function usePlanningReorder() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: any) => productionApi.reorderPlanningQueue(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["planning-queue"] })
      queryClient.invalidateQueries({ queryKey: ["planning-job-cards"] })
      queryClient.invalidateQueries({ queryKey: ["planning-job-card"] })
    },
  })
}

export function usePlanningBoardMove() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: any) => productionApi.movePlanningBoard(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["planning-board"] })
      queryClient.invalidateQueries({ queryKey: ["planning-queue"] })
      queryClient.invalidateQueries({ queryKey: ["planning-job-cards"] })
      queryClient.invalidateQueries({ queryKey: ["planning-job-card"] })
      queryClient.invalidateQueries({ queryKey: ["analytics-production-live-wip"] })
    },
  })
}

export function useSplitPlanningSegment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: any) => productionApi.splitPlanningSegment(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["planning-board"] })
      queryClient.invalidateQueries({ queryKey: ["planning-queue"] })
      queryClient.invalidateQueries({ queryKey: ["planning-job-cards"] })
      queryClient.invalidateQueries({ queryKey: ["planning-job-card"] })
      queryClient.invalidateQueries({ queryKey: ["analytics-production-live-wip"] })
    },
  })
}

export function useAssignMachine() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ jobCardId, data }: { jobCardId: string; data: any }) =>
      productionApi.assignMachine(jobCardId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["planning-queue"] })
      queryClient.invalidateQueries({ queryKey: ["planning-job-cards"] })
      queryClient.invalidateQueries({ queryKey: ["planning-job-card"] })
      queryClient.invalidateQueries({ queryKey: ["analytics-production-live-wip"] })
    },
  })
}

export function usePostStageOutput() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ jobCardId, data }: { jobCardId: string; data: any }) =>
      productionApi.postStageOutput(jobCardId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["planning-queue"] })
      queryClient.invalidateQueries({ queryKey: ["planning-job-cards"] })
      queryClient.invalidateQueries({ queryKey: ["planning-job-card"] })
      queryClient.invalidateQueries({ queryKey: ["analytics-production-live-wip"] })
      queryClient.invalidateQueries({ queryKey: ["analytics-production-oee"] })
    },
  })
}

export function useSaveStageDraft() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ jobCardId, data }: { jobCardId: string; data: any }) =>
      productionApi.postStageOutput(jobCardId, { ...data, save_mode: "draft" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["planning-queue"] })
      queryClient.invalidateQueries({ queryKey: ["planning-job-cards"] })
      queryClient.invalidateQueries({ queryKey: ["planning-job-card"] })
      queryClient.invalidateQueries({ queryKey: ["analytics-production-live-wip"] })
      queryClient.invalidateQueries({ queryKey: ["analytics-production-oee"] })
    },
  })
}

export function useCompleteStageEntry() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ jobCardId, data }: { jobCardId: string; data: any }) =>
      productionApi.postStageOutput(jobCardId, { ...data, save_mode: "complete" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["planning-queue"] })
      queryClient.invalidateQueries({ queryKey: ["planning-job-cards"] })
      queryClient.invalidateQueries({ queryKey: ["planning-job-card"] })
    },
  })
}

export function useCreatePlanningSalesOrder() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: any) => productionApi.createPlanningSalesOrder(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["planning-job-cards"] })
    },
  })
}

export function useReleaseSyncSalesOrder() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ salesOrderId, data }: { salesOrderId: string; data: any }) =>
      productionApi.releaseSyncSalesOrder(salesOrderId, data),
    onSuccess: (_response, variables) => {
      queryClient.invalidateQueries({ queryKey: ["planning-board"] })
      queryClient.invalidateQueries({ queryKey: ["planning-queue"] })
      queryClient.invalidateQueries({ queryKey: ["planning-job-cards"] })
      queryClient.invalidateQueries({ queryKey: ["planning-job-card"] })
      queryClient.invalidateQueries({ queryKey: ["sales", "orders"] })
      queryClient.invalidateQueries({ queryKey: ["sales", "order", variables.salesOrderId] })
      queryClient.invalidateQueries({ queryKey: ["sales", "timeline", variables.salesOrderId] })
      queryClient.invalidateQueries({ queryKey: ["sales", "released-lines"] })
    },
  })
}

export function useCreatePlanningJobCard() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: any) => productionApi.createPlanningJobCard(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["planning-queue"] })
      queryClient.invalidateQueries({ queryKey: ["planning-job-cards"] })
    },
  })
}

export function useShiftMaterialLedger(params?: any) {
  return useQuery({
    queryKey: ["shift-material-ledger", params || {}],
    queryFn: async () => {
      const { data } = await productionApi.getShiftMaterialLedger(params)
      return data
    },
  })
}

export function useShiftMaterialRetally(params?: any) {
  return useQuery({
    queryKey: ["shift-material-retally", params || {}],
    queryFn: async () => {
      const { data } = await productionApi.getShiftMaterialRetally(params)
      return data
    },
  })
}

export function usePlantRetallySummary(params?: any) {
  return useQuery({
    queryKey: ["plant-retally-summary", params || {}],
    queryFn: async () => {
      const { data } = await productionApi.getPlantRetallySummary(params)
      return data
    },
  })
}

export function useMonthlyMaterialSummary(params?: any, enabled = true) {
  return useQuery({
    queryKey: ["monthly-material-summary", params || {}],
    queryFn: async () => {
      const { data } = await productionApi.getMonthlyMaterialSummary(params)
      return data
    },
    enabled,
  })
}

export function useMonthlyCloseState(params?: any, enabled = true) {
  return useQuery({
    queryKey: ["monthly-close-state", params || {}],
    queryFn: async () => {
      const { data } = await productionApi.getMonthlyCloseState(params)
      return data
    },
    enabled,
  })
}

export function useCreateShiftMaterialLedger() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: any) => productionApi.createShiftMaterialLedger(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shift-material-ledger"] })
      queryClient.invalidateQueries({ queryKey: ["shift-material-retally"] })
      queryClient.invalidateQueries({ queryKey: ["plant-retally-summary"] })
      queryClient.invalidateQueries({ queryKey: ["planning-job-cards"] })
      queryClient.invalidateQueries({ queryKey: ["planning-job-card"] })
    },
  })
}

export function useImportMonthlyActuals() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ payload, plantId }: { payload: any; plantId?: string }) =>
      productionApi.importMonthlyActuals(payload, plantId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["monthly-material-summary"] })
      queryClient.invalidateQueries({ queryKey: ["monthly-close-state"] })
      queryClient.invalidateQueries({ queryKey: ["plant-retally-summary"] })
    },
  })
}

export function useApproveMonthlyClose() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ payload, plantId }: { payload: any; plantId?: string }) =>
      productionApi.approveMonthlyClose(payload, plantId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["monthly-material-summary"] })
      queryClient.invalidateQueries({ queryKey: ["monthly-close-state"] })
      queryClient.invalidateQueries({ queryKey: ["plant-retally-summary"] })
    },
  })
}

export function useUpdateJobCard() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => productionApi.updateJobCard(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["job-cards"] })
      queryClient.invalidateQueries({ queryKey: ["planning-job-cards"] })
    },
  })
}

export function useValidateJobCard() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => productionApi.validateJobCard(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["job-cards"] })
      queryClient.invalidateQueries({ queryKey: ["planning-job-cards"] })
    },
  })
}

export function useCloseJobCard() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => productionApi.closeJobCard(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["job-cards"] })
      queryClient.invalidateQueries({ queryKey: ["planning-job-cards"] })
    },
  })
}

export function useAddReelIssue() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ jobId, data }: { jobId: string; data: any }) => productionApi.addReelIssue(jobId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["job-cards"] })
      queryClient.invalidateQueries({ queryKey: ["planning-job-cards"] })
    },
  })
}
