import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { inventoryApi } from "@/lib/api"

export function useInventoryItems() {
  return useQuery({
    queryKey: ["inventory-items"],
    queryFn: async () => {
      const { data } = await inventoryApi.getItems()
      return data
    },
  })
}

export function useInventoryTransactions() {
  return useQuery({
    queryKey: ["inventory-transactions"],
    queryFn: async () => {
      const { data } = await inventoryApi.getTransactions()
      return data
    },
  })
}

export function useCreateTransaction() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: any) => inventoryApi.createTransaction(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-items"] })
      queryClient.invalidateQueries({ queryKey: ["inventory-transactions"] })
    },
  })
}

export function useCreateInward() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: any) => inventoryApi.createInward(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-items"] })
      queryClient.invalidateQueries({ queryKey: ["inventory-transactions"] })
    },
  })
}

export function useCreateItem() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: any) => inventoryApi.createItem(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-items"] })
    },
  })
}
