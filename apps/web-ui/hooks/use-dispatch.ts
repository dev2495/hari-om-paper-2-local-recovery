import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { dispatchApi, inventoryApi, masterApi } from "@/lib/api"

export function useReadyJobs() {
  return useQuery({
    queryKey: ["ready-jobs"],
    queryFn: async () => {
      const { data } = await dispatchApi.getReadyJobs()
      return data
    },
  })
}

export function useDispatches() {
  return useQuery({
    queryKey: ["dispatches"],
    queryFn: async () => {
      const { data } = await dispatchApi.getReadyJobs()
      return Array.isArray(data) ? data : []
    },
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

export function useCreateDispatch() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: any) => inventoryApi.createDispatch(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dispatches"] })
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
