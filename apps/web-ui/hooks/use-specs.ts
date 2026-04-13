import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { specApi } from "@/lib/api"

export function useSpecs() {
  return useQuery({
    queryKey: ["specs"],
    queryFn: async () => {
      const { data } = await specApi.getSpecs()
      return data
    },
  })
}

export function useCreateSpec() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: any) => specApi.createSpec(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["specs"] })
    },
  })
}

export function useSpec(id: string) {
  return useQuery({
    queryKey: ["specs", id],
    queryFn: async () => {
      const { data } = await specApi.getSpec(id)
      return data
    },
    enabled: !!id,
  })
}

export function useRecipesForSpec(specId: string, _status?: string) {
  return useQuery({
    queryKey: ["specs", specId, "recipes"],
    queryFn: async () => {
      const { data } = await specApi.getRecipesForSpec(specId)
      return Array.isArray(data) ? data : data?.items || data?.rows || []
    },
    enabled: !!specId,
  })
}
