import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { dispatchApi, inventoryApi, masterApi } from "@/lib/api"

function isConcretePlant(plantId?: string | null) {
  return Boolean(plantId && String(plantId).toUpperCase() !== "ALL")
}

export function useReadyJobs(plantId?: string | null) {
  return useQuery({
    queryKey: ["ready-jobs", plantId || null],
    queryFn: async () => {
      const { data } = await dispatchApi.getReadyJobs(plantId || undefined)
      return data
    },
    enabled: Boolean(plantId),
  })
}

export function useDispatches(plantId?: string | null) {
  return useQuery({
    queryKey: ["dispatches", plantId || null],
    queryFn: async () => {
      const { data } = await dispatchApi.getReadyJobs(plantId || undefined)
      return Array.isArray(data) ? data : []
    },
    enabled: Boolean(plantId),
  })
}

export function useDispatch(id: string | null, plantId?: string | null) {
  return useQuery({
    queryKey: ["dispatch", id, plantId || null],
    queryFn: async () => {
      if (!id) return null
      const { data } = await dispatchApi.getDispatch(id, plantId || undefined)
      return data
    },
    enabled: !!id,
  })
}

export function useDispatchByJobCard(jobCardId: string | null, draftsOnly = false, plantId?: string | null) {
  return useQuery({
    queryKey: ["dispatch-by-job", jobCardId, draftsOnly, plantId || null],
    queryFn: async () => {
      if (!jobCardId) return null
      const { data } = await dispatchApi.getDispatchByJob(jobCardId, draftsOnly, plantId || undefined)
      return data
    },
    enabled: !!jobCardId,
  })
}

export function useCreateOrUpdateDispatch(plantId?: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: any) => {
      if (!isConcretePlant(plantId)) throw new Error("The job card's plant is required to save a dispatch")
      return dispatchApi.createOrUpdateDispatch(data, plantId || undefined)
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey: ["dispatch-by-job"] })
      queryClient.invalidateQueries({ queryKey: ["ready-jobs"] })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dispatch-by-job"] })
      queryClient.invalidateQueries({ queryKey: ["ready-jobs"] })
      queryClient.invalidateQueries({ queryKey: ["dispatch"] })
      queryClient.invalidateQueries({ queryKey: ["dispatches"] })
      queryClient.invalidateQueries({ queryKey: ["planning-job-card"] })
      queryClient.invalidateQueries({ queryKey: ["planning-job-cards"] })
      queryClient.invalidateQueries({ queryKey: ["continuous-flow"] })
      queryClient.invalidateQueries({ queryKey: ["sales-orders"] })
      queryClient.invalidateQueries({ queryKey: ["sales"] })
      queryClient.invalidateQueries({ queryKey: ["purchase-v2", "sales-bom-demand"] })
      queryClient.invalidateQueries({ queryKey: ["inventory-items"] })
    },
  })
}

export function useCreateDispatch(plantId?: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: any) => inventoryApi.createDispatch(data, plantId || undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dispatches"] })
      queryClient.invalidateQueries({ queryKey: ["dispatch-by-job"] })
      queryClient.invalidateQueries({ queryKey: ["ready-jobs"] })
      queryClient.invalidateQueries({ queryKey: ["inventory-items"] })
    },
  })
}

export function useCustomers() {
  return useQuery({
    queryKey: ["customers"],
    queryFn: async () => {
      const { data } = await masterApi.getCustomers()
      return data
    },
  })
}
