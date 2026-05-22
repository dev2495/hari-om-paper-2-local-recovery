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
    enabled: isConcretePlant(plantId),
  })
}

export function useDispatches(plantId?: string | null) {
  return useQuery({
    queryKey: ["dispatches", plantId || null],
    queryFn: async () => {
      const { data } = await dispatchApi.getReadyJobs(plantId || undefined)
      return Array.isArray(data) ? data : []
    },
    enabled: isConcretePlant(plantId),
  })
}

export function useDispatch(id: string | null) {
  return useQuery({
    queryKey: ["dispatch", id],
    queryFn: async () => {
      if (!id) return null
      const { data } = await dispatchApi.getDispatch(id)
      return data
    },
    enabled: !!id,
  })
}

export function useDispatchByJobCard(jobCardId: string | null) {
  return useQuery({
    queryKey: ["dispatch-by-job", jobCardId],
    queryFn: async () => {
      if (!jobCardId) return null
      const { data } = await dispatchApi.getDispatchByJob(jobCardId)
      return data
    },
    enabled: !!jobCardId,
  })
}

export function useCreateOrUpdateDispatch() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: any) => dispatchApi.createOrUpdateDispatch(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ready-jobs"] })
      queryClient.invalidateQueries({ queryKey: ["dispatch"] })
    },
  })
}

export function useCreateDispatch(plantId?: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: any) => inventoryApi.createDispatch(data, plantId || undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dispatches"] })
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
