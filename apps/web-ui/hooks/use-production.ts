import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { productionApi } from "@/lib/api"

export function useJobCards() {
  return useQuery({
    queryKey: ["job-cards"],
    queryFn: async () => {
      const { data } = await productionApi.getJobCards()
      return data
    },
  })
}

export function usePlanningJobCard(id: string) {
  return useQuery({
    queryKey: ["planning-job-card", id],
    queryFn: async () => {
      const { data } = await productionApi.getPlanningJobCard(id)
      return data
    },
    enabled: !!id,
  })
}

export function useCreateJobCard() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: any) => productionApi.createJobCard(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["job-cards"] })
      queryClient.invalidateQueries({ queryKey: ["planning-job-card"] })
    },
  })
}

export function useUpdateJobCard() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => productionApi.updateJobCard(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["job-cards"] })
    },
  })
}

export function useAddReelIssue() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, jobId, data }: { id?: string; jobId?: string; data: any }) =>
      productionApi.addReelIssue(String(id || jobId || ""), data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["job-cards"] })
    },
  })
}

export function useValidateJobCard() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => productionApi.validateJobCard(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["job-cards"] })
    },
  })
}

export function useCloseJobCard() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => productionApi.closeJobCard(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["job-cards"] })
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
