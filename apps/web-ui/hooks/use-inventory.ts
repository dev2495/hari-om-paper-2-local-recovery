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

export function useReelIssues(params?: any, enabled = true) {
  return useQuery({
    queryKey: ["inventory-reel-issues", params],
    queryFn: async () => {
      const { data } = await inventoryApi.getReelIssues(params)
      return data
    },
    enabled,
  })
}

export function useInventoryHealthSummary() {
  return useQuery({
    queryKey: ["inventory-health-summary"],
    queryFn: async () => {
      const [balancesResult, itemsResult] = await Promise.allSettled([
        inventoryApi.getBalances(),
        inventoryApi.getItems(),
      ])

      const balancesData =
        balancesResult.status === "fulfilled"
          ? balancesResult.value?.data
          : null
      const itemsData =
        itemsResult.status === "fulfilled"
          ? itemsResult.value?.data
          : null

      const rows = Array.isArray(balancesData)
        ? balancesData
        : Array.isArray(balancesData?.items)
          ? balancesData.items
          : Array.isArray(itemsData)
            ? itemsData
            : Array.isArray(itemsData?.items)
              ? itemsData.items
              : []

      const lowStockItems = rows.filter((row: any) => {
        const available = Number(row.available_qty ?? row.qty_on_hand ?? row.qty_available ?? 0)
        const minimum = Number(row.min_qty ?? row.reorder_level ?? row.min_level ?? 0)
        return minimum > 0 && available <= minimum
      })

      const totalValue = rows.reduce((sum: number, row: any) => {
        const qty = Number(row.available_qty ?? row.qty_on_hand ?? row.qty_available ?? 0)
        const unitCost = Number(row.unit_cost ?? row.avg_rate ?? row.rate ?? row.price ?? 0)
        return sum + qty * unitCost
      }, 0)

      return {
        summary: {
          low_stock_items: lowStockItems.length,
          total_value: totalValue,
          blocked_qty: 0,
        },
        low_stock_items: lowStockItems.length,
        rows,
      }
    },
  })
}

export function useInventoryBalances() {
  return useQuery({
    queryKey: ["inventory-balances"],
    queryFn: async () => {
      const { data } = await inventoryApi.getBalances()
      return Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : []
    },
  })
}

export function useLotAvailability(itemId?: string, specId?: string) {
  return useQuery({
    queryKey: ["inventory-lot-availability", itemId || "", specId || ""],
    queryFn: async () => {
      if (!itemId) return []
      const { data } = await inventoryApi.getLotAvailability(itemId, specId)
      return Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : []
    },
    enabled: Boolean(itemId),
  })
}

export function useReels(params?: any, enabled = true) {
  return useQuery({
    queryKey: ["inventory-reels", params || {}],
    queryFn: async () => {
      const { data } = await inventoryApi.getReels(params)
      return Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : []
    },
    enabled,
  })
}

export function useReelScans(reelId?: string, params?: any, enabled = true) {
  return useQuery({
    queryKey: ["inventory-reel-scans", reelId || "", params || {}],
    queryFn: async () => {
      if (!reelId) return []
      const { data } = await inventoryApi.getReelScans(reelId, params)
      return Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : []
    },
    enabled: Boolean(reelId) && enabled,
  })
}

export function useCreateReelInward() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: any) => inventoryApi.createReelInward(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-reels"] })
      queryClient.invalidateQueries({ queryKey: ["inventory-items"] })
    },
  })
}

export function useCreateReelScan() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ reelId, data }: { reelId: string; data: any }) => inventoryApi.createReelScan(reelId, data),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["inventory-reel-scans", variables.reelId] })
    },
  })
}

export function useCreateReelIssue() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: any) => inventoryApi.createReelIssue(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-reel-issues"] })
      queryClient.invalidateQueries({ queryKey: ["inventory-reels"] })
    },
  })
}

export function useCloseReelIssue() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => inventoryApi.closeReelIssue(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-reel-issues"] })
      queryClient.invalidateQueries({ queryKey: ["inventory-reels"] })
    },
  })
}
