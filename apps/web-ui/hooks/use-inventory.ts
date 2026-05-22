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

export function useInventoryTransactions(params?: { item_id?: string; date_from?: string; date_to?: string; transaction_type?: string }) {
  return useQuery({
    queryKey: ["inventory-transactions", params || {}],
    queryFn: async () => {
      const { data } = await inventoryApi.getTransactions(params)
      return Array.isArray(data) ? data : Array.isArray(data?.ledger) ? data.ledger : Array.isArray(data?.items) ? data.items : []
    },
  })
}

export function useInventoryLocations() {
  return useQuery({
    queryKey: ["inventory-locations"],
    queryFn: async () => {
      const { data } = await inventoryApi.getLocations()
      return Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : []
    },
  })
}

export function useCreateInventoryLocation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: any) => inventoryApi.createLocation(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-locations"] })
      queryClient.invalidateQueries({ queryKey: ["inventory-location-occupancy"] })
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
      queryClient.invalidateQueries({ queryKey: ["inventory-stock-statement"] })
      queryClient.invalidateQueries({ queryKey: ["inventory-location-occupancy"] })
      queryClient.invalidateQueries({ queryKey: ["inventory-balances"] })
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
      queryClient.invalidateQueries({ queryKey: ["inventory-stock-statement"] })
      queryClient.invalidateQueries({ queryKey: ["inventory-location-occupancy"] })
      queryClient.invalidateQueries({ queryKey: ["inventory-balances"] })
    },
  })
}

export function useCreateItem() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: any) => inventoryApi.createItem(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-items"] })
      queryClient.invalidateQueries({ queryKey: ["inventory-balances"] })
    },
  })
}

export function useUpdateItem() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => inventoryApi.updateItem(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-items"] })
      queryClient.invalidateQueries({ queryKey: ["inventory-balances"] })
      queryClient.invalidateQueries({ queryKey: ["inventory-valuation-summary"] })
      queryClient.invalidateQueries({ queryKey: ["inventory-stock-statement"] })
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

export function useInventoryStatusSummary() {
  return useQuery({
    queryKey: ["inventory-status-summary"],
    queryFn: async () => {
      const { data } = await inventoryApi.getInventoryStatusSummary()
      return data || { rows: [], totals: {} }
    },
  })
}

export function useInventoryLocationOccupancy() {
  return useQuery({
    queryKey: ["inventory-location-occupancy"],
    queryFn: async () => {
      const { data } = await inventoryApi.getInventoryLocationOccupancy()
      return data || { summary: {}, rows: [] }
    },
  })
}

export function useInventoryAging() {
  return useQuery({
    queryKey: ["inventory-aging"],
    queryFn: async () => {
      const { data } = await inventoryApi.getInventoryAging()
      return data || { buckets: [], slow_rows: [] }
    },
  })
}

export function useInventoryGenealogyExceptions() {
  return useQuery({
    queryKey: ["inventory-genealogy-exceptions"],
    queryFn: async () => {
      const { data } = await inventoryApi.getInventoryGenealogyExceptions()
      return data || { rows: [] }
    },
  })
}

export function useInventoryValuationSummary() {
  return useQuery({
    queryKey: ["inventory-valuation-summary"],
    queryFn: async () => {
      const { data } = await inventoryApi.getValuationSummary()
      return data || { rows: [], totals: {} }
    },
  })
}

export function useInventoryValuationReels() {
  return useQuery({
    queryKey: ["inventory-valuation-reels"],
    queryFn: async () => {
      const { data } = await inventoryApi.getValuationReels()
      return data || { rows: [], totals: {} }
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

export function useInventoryStockStatement(params?: any) {
  return useQuery({
    queryKey: ["inventory-stock-statement", params || {}],
    queryFn: async () => {
      const { data } = await inventoryApi.getStockStatement(params)
      return data || { rows: [], totals: {} }
    },
    enabled: Boolean(params?.start_date && params?.end_date),
  })
}

export function useOpeningLoads() {
  return useQuery({
    queryKey: ["inventory-opening-loads"],
    queryFn: async () => {
      const { data } = await inventoryApi.getOpeningLoads()
      return Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : []
    },
  })
}

export function useCreateOpeningLoad() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: any) => inventoryApi.createOpeningLoad(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-opening-loads"] })
      queryClient.invalidateQueries({ queryKey: ["inventory-stock-statement"] })
      queryClient.invalidateQueries({ queryKey: ["inventory-balances"] })
      queryClient.invalidateQueries({ queryKey: ["inventory-reels"] })
    },
  })
}

export function useStockCertifications() {
  return useQuery({
    queryKey: ["inventory-stock-certifications"],
    queryFn: async () => {
      const { data } = await inventoryApi.getStockCertifications()
      return Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : []
    },
  })
}

export function useCreateStockCertification() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: any) => inventoryApi.createStockCertification(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-stock-certifications"] })
      queryClient.invalidateQueries({ queryKey: ["inventory-stock-statement"] })
    },
  })
}

export function useUpdateStockCertification() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => inventoryApi.updateStockCertification(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-stock-certifications"] })
      queryClient.invalidateQueries({ queryKey: ["inventory-stock-certification"] })
    },
  })
}

export function useCertifyStockCertification() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data?: any }) => inventoryApi.certifyStockCertification(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-stock-certifications"] })
      queryClient.invalidateQueries({ queryKey: ["inventory-stock-certification"] })
    },
  })
}

export function useCarryForwards() {
  return useQuery({
    queryKey: ["inventory-carry-forwards"],
    queryFn: async () => {
      const { data } = await inventoryApi.getCarryForwards()
      return Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : []
    },
  })
}

export function useCreateCarryForward() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data?: any }) => inventoryApi.createCarryForward(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-carry-forwards"] })
      queryClient.invalidateQueries({ queryKey: ["inventory-stock-certifications"] })
      queryClient.invalidateQueries({ queryKey: ["inventory-stock-certification"] })
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
      queryClient.invalidateQueries({ queryKey: ["inventory-stock-statement"] })
      queryClient.invalidateQueries({ queryKey: ["inventory-location-occupancy"] })
      queryClient.invalidateQueries({ queryKey: ["inventory-balances"] })
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
      queryClient.invalidateQueries({ queryKey: ["inventory-stock-statement"] })
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

// ──────────────────────────────────────────────────────────────────────────
// Lifecycle gap hooks
// ──────────────────────────────────────────────────────────────────────────

export function useManualFgInward() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ data, plantId }: { data: any; plantId?: string }) =>
      inventoryApi.createManualFgInward(data, plantId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-balances"] })
      queryClient.invalidateQueries({ queryKey: ["inventory-transactions"] })
      queryClient.invalidateQueries({ queryKey: ["inventory-items"] })
    },
  })
}

export function usePostOpeningFromCarryForward() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ cfId, plantId }: { cfId: string; plantId?: string }) =>
      inventoryApi.postOpeningFromCarryForward(cfId, plantId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-opening-loads"] })
      queryClient.invalidateQueries({ queryKey: ["inventory-stock-certifications"] })
      queryClient.invalidateQueries({ queryKey: ["inventory-carry-forwards"] })
      queryClient.invalidateQueries({ queryKey: ["inventory-stock-statement"] })
      queryClient.invalidateQueries({ queryKey: ["inventory-balances"] })
    },
  })
}

export function useTransactionsAggregateByItem(params?: { start_date?: string; end_date?: string; transaction_types?: string }, enabled = true) {
  return useQuery({
    queryKey: ["inventory-tx-aggregate", params],
    queryFn: async () => {
      const { data } = await inventoryApi.getTransactionsAggregateByItem({
        start_date: String(params?.start_date),
        end_date: String(params?.end_date),
        transaction_types: params?.transaction_types,
      })
      return Array.isArray(data) ? data : []
    },
    enabled: enabled && Boolean(params?.start_date) && Boolean(params?.end_date),
  })
}
