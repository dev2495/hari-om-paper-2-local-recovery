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

export function useToolAssets(params?: any) {
  return useQuery({
    queryKey: ["tool-assets", params || {}],
    queryFn: async () => {
      const { data } = await inventoryApi.getToolAssets(params)
      return Array.isArray(data) ? data : []
    },
  })
}

export function useToolAsset(id?: string) {
  return useQuery({
    queryKey: ["tool-asset", id || ""],
    queryFn: async () => {
      const { data } = await inventoryApi.getToolAsset(String(id))
      return data || { asset: null, events: [] }
    },
    enabled: Boolean(id),
  })
}

export function useToolAssetReport() {
  return useQuery({
    queryKey: ["tool-asset-report"],
    queryFn: async () => {
      const { data } = await inventoryApi.getToolAssetReport()
      return data || { summary: {}, by_category: [] }
    },
  })
}

export function useReceiveToolAssets() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: any) => inventoryApi.receiveToolAssets(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tool-assets"] })
      queryClient.invalidateQueries({ queryKey: ["tool-asset"] })
      queryClient.invalidateQueries({ queryKey: ["tool-asset-report"] })
    },
  })
}

function useToolAssetMutation(fn: (id: string, data?: any) => any) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data?: any }) => fn(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tool-assets"] })
      queryClient.invalidateQueries({ queryKey: ["tool-asset-report"] })
    },
  })
}

export const useIssueToolAsset = () => useToolAssetMutation(inventoryApi.issueToolAsset)
export const useReturnToolAsset = () => useToolAssetMutation(inventoryApi.returnToolAsset)
export const useMoveToolAsset = () => useToolAssetMutation(inventoryApi.moveToolAsset)
export const useGrindingOutToolAsset = () => useToolAssetMutation(inventoryApi.grindingOutToolAsset)
export const useGrindingReturnToolAsset = () => useToolAssetMutation(inventoryApi.grindingReturnToolAsset)
export const useMaintainToolAsset = () => useToolAssetMutation(inventoryApi.maintainToolAsset)
export const useCompleteToolMaintenance = () => useToolAssetMutation(inventoryApi.completeToolMaintenance)
export const useScrapToolAsset = () => useToolAssetMutation(inventoryApi.scrapToolAsset)

export function useInventoryItemBalance(itemId?: string, enabled = true) {
  return useQuery({
    queryKey: ["inventory-item-balance", itemId || ""],
    queryFn: async () => {
      if (!itemId) return null
      const { data } = await inventoryApi.getItemBalance(itemId)
      return data
    },
    enabled: enabled && Boolean(itemId),
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

export function useIssueBatchToWip() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: any) => inventoryApi.issueBatchToWip(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-items"] })
      queryClient.invalidateQueries({ queryKey: ["inventory-item-balance"] })
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

export function useInwardStockAsOn(params?: any) {
  return useQuery({
    queryKey: ["inventory-inward-stock-as-on", params || {}],
    queryFn: async () => {
      const { data } = await inventoryApi.getInwardStockAsOn(params)
      return data || { items: [], rows: [], totals: {} }
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

export function useUpsertItemQualityProfile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => inventoryApi.upsertItemQualityProfile(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-items"] })
      queryClient.invalidateQueries({ queryKey: ["inventory-quality-pending"] })
    },
  })
}

export function useCopyItemQualityTemplate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data?: any }) => inventoryApi.copyItemQualityTemplate(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-items"] })
      queryClient.invalidateQueries({ queryKey: ["inventory-quality-pending"] })
    },
  })
}

export function useApproveItemQualityProfile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => inventoryApi.approveItemQualityProfile(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-items"] })
      queryClient.invalidateQueries({ queryKey: ["inventory-quality-pending"] })
    },
  })
}

/** Masters: re-band QC's existing inward-QC parameters; the result awaits Owner/Admin approval. */
export function useAdjustItemQualityTolerances() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof inventoryApi.adjustItemQualityTolerances>[1] }) => inventoryApi.adjustItemQualityTolerances(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-items"] })
      queryClient.invalidateQueries({ queryKey: ["inventory-quality-pending"] })
    },
  })
}

export function useDeleteItem() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => inventoryApi.deleteItem(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-items"] })
      queryClient.invalidateQueries({ queryKey: ["inventory-balances"] })
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

/** Re-sync a draft count sheet: new items added, book stock moved to now, counts kept. */
export function useRefreshStockCertification() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => inventoryApi.refreshStockCertification(id),
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

export function usePostStockCertificationVariance() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => inventoryApi.postStockCertificationVariance(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-stock-certifications"] })
      queryClient.invalidateQueries({ queryKey: ["inventory-stock-certification"] })
      queryClient.invalidateQueries({ queryKey: ["inventory-adjustment-vouchers"] })
      queryClient.invalidateQueries({ queryKey: ["inventory-stock-statement"] })
      queryClient.invalidateQueries({ queryKey: ["inventory-balances"] })
      queryClient.invalidateQueries({ queryKey: ["inventory-reels"] })
    },
  })
}

export function useAdjustmentVouchers() {
  return useQuery({
    queryKey: ["inventory-adjustment-vouchers"],
    queryFn: async () => {
      const { data } = await inventoryApi.getAdjustmentVouchers()
      return Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : []
    },
  })
}

export function useCreateAdjustmentVoucher() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: any) => inventoryApi.createAdjustmentVoucher(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-adjustment-vouchers"] })
      queryClient.invalidateQueries({ queryKey: ["inventory-stock-statement"] })
      queryClient.invalidateQueries({ queryKey: ["inventory-balances"] })
      queryClient.invalidateQueries({ queryKey: ["inventory-reels"] })
    },
  })
}

export function usePostAdjustmentVoucher() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => inventoryApi.postAdjustmentVoucher(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-adjustment-vouchers"] })
      queryClient.invalidateQueries({ queryKey: ["inventory-stock-statement"] })
      queryClient.invalidateQueries({ queryKey: ["inventory-balances"] })
      queryClient.invalidateQueries({ queryKey: ["inventory-reels"] })
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

export function useSlitCoil() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: any) => inventoryApi.slitCoil(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-reel-issues"] })
      queryClient.invalidateQueries({ queryKey: ["inventory-reels"] })
    },
  })
}

export function useInventoryQualityTemplates(materialType?: string) {
  return useQuery({
    queryKey: ["inventory-quality-templates", materialType || "all"],
    queryFn: async () => {
      const { data } = await inventoryApi.getQualityTemplates(materialType ? { material_type: materialType } : undefined)
      return Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : []
    },
  })
}

export function useUpsertInventoryQualityTemplate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: any) => inventoryApi.upsertQualityTemplate(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-quality-templates"] })
    },
  })
}

export function usePendingInventoryQuality(enabled = true) {
  return useQuery({
    queryKey: ["inventory-quality-pending"],
    queryFn: async () => {
      const { data } = await inventoryApi.getPendingQuality()
      return Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : []
    },
    enabled,
  })
}

export function useInventoryQualityInspections(params?: any, enabled = true) {
  return useQuery({
    queryKey: ["inventory-quality-inspections", params || {}],
    queryFn: async () => {
      const { data } = await inventoryApi.getInventoryQualityInspections(params)
      return Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : []
    },
    enabled,
  })
}

export function useInventoryQualityConcessions(params?: any) {
  return useQuery({
    queryKey: ["inventory-quality-concessions", params || {}],
    queryFn: async () => {
      const { data } = await inventoryApi.getInventoryQualityConcessions(params)
      return Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : []
    },
  })
}

export function useCreateInventoryQualityInspection() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: any) => inventoryApi.createInventoryQualityInspection(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-quality-pending"] })
      queryClient.invalidateQueries({ queryKey: ["inventory-quality-inspections"] })
      queryClient.invalidateQueries({ queryKey: ["inventory-reels"] })
      queryClient.invalidateQueries({ queryKey: ["inventory-items"] })
      queryClient.invalidateQueries({ queryKey: ["inventory-transactions"] })
      queryClient.invalidateQueries({ queryKey: ["inventory-balances"] })
      queryClient.invalidateQueries({ queryKey: ["inventory-stock-statement"] })
      queryClient.invalidateQueries({ queryKey: ["inventory-location-occupancy"] })
    },
  })
}

function invalidateIncomingQc(queryClient: ReturnType<typeof useQueryClient>) {
  for (const key of [
    "inventory-quality-pending",
    "inventory-quality-inspections",
    "inventory-quality-concessions",
    "inventory-reels",
    "inventory-items",
    "inventory-transactions",
    "inventory-balances",
    "inventory-stock-statement",
  ]) {
    queryClient.invalidateQueries({ queryKey: [key] })
  }
}

export function useCreateInventoryQualityConcession() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: any) => inventoryApi.createInventoryQualityConcession(data),
    onSuccess: () => invalidateIncomingQc(queryClient),
  })
}

export function useReturnRejectedLotToSupplier() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: { entity_type: string; entity_id: string; reason: string; return_reference?: string }) =>
      inventoryApi.returnRejectedLotToSupplier(data),
    onSuccess: () => {
      invalidateIncomingQc(queryClient)
      queryClient.invalidateQueries({ queryKey: ["purchase-v2"] })
    },
  })
}

export function useCustomerRejections(params?: any, enabled = true) {
  return useQuery({
    queryKey: ["inventory-customer-rejections", params || {}],
    queryFn: async () => {
      const { data } = await inventoryApi.getCustomerRejections(params)
      return Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : []
    },
    enabled,
  })
}

export function useCreateCustomerRejection() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: any) => inventoryApi.createCustomerRejection(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-customer-rejections"] })
      queryClient.invalidateQueries({ queryKey: ["inventory-quality-pending"] })
      queryClient.invalidateQueries({ queryKey: ["inventory-items"] })
      queryClient.invalidateQueries({ queryKey: ["inventory-transactions"] })
      queryClient.invalidateQueries({ queryKey: ["inventory-balances"] })
    },
  })
}

export function useDisposeCustomerRejection() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => inventoryApi.disposeCustomerRejection(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-customer-rejections"] })
      queryClient.invalidateQueries({ queryKey: ["inventory-quality-pending"] })
      queryClient.invalidateQueries({ queryKey: ["inventory-quality-inspections"] })
      queryClient.invalidateQueries({ queryKey: ["inventory-items"] })
      queryClient.invalidateQueries({ queryKey: ["inventory-transactions"] })
      queryClient.invalidateQueries({ queryKey: ["inventory-balances"] })
      queryClient.invalidateQueries({ queryKey: ["inventory-stock-statement"] })
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

// ── Inward QC standards (client rule 2026-10-18) ────────────────────────────
// QC keeps the parameter list per material type; Masters set the tolerance bands per line or group.
const standardsKeys = ["quality-standard-parameters", "quality-standard-tolerances", "quality-standard-history", "quality-standard-scope", "inventory-items", "inventory-quality-pending"]

function invalidateStandards(queryClient: ReturnType<typeof useQueryClient>) {
  standardsKeys.forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }))
}

export function useQualityStandardTypes() {
  return useQuery({
    queryKey: ["quality-standard-types"],
    queryFn: async () => (await inventoryApi.getQualityStandardTypes()).data as Array<{ material_type: string; label: string; group: string; subgroup: string | null; master: string | null }>,
    staleTime: 10 * 60_000,
  })
}

export function useQualityStandardParameters(materialType: string) {
  return useQuery({
    queryKey: ["quality-standard-parameters", materialType],
    queryFn: async () => (await inventoryApi.getQualityStandardParameters(materialType)).data as any[],
    enabled: Boolean(materialType),
  })
}

export function useCreateQualityStandardParameter() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Parameters<typeof inventoryApi.createQualityStandardParameter>[0]) => inventoryApi.createQualityStandardParameter(data),
    onSuccess: () => invalidateStandards(queryClient),
  })
}

export function useUpdateQualityStandardParameter() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof inventoryApi.updateQualityStandardParameter>[1] }) => inventoryApi.updateQualityStandardParameter(id, data),
    onSuccess: () => invalidateStandards(queryClient),
  })
}

export function useQualityStandardTolerances(materialType: string) {
  return useQuery({
    queryKey: ["quality-standard-tolerances", materialType],
    queryFn: async () => (await inventoryApi.getQualityStandardTolerances(materialType)).data as any,
    enabled: Boolean(materialType),
  })
}

export function useSaveQualityStandardTolerances() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Parameters<typeof inventoryApi.saveQualityStandardTolerances>[0]) => inventoryApi.saveQualityStandardTolerances(data),
    onSuccess: () => invalidateStandards(queryClient),
  })
}

export function useSaveQualityStandardItem() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof inventoryApi.saveQualityStandardItem>[1] }) => inventoryApi.saveQualityStandardItem(id, data),
    onSuccess: () => invalidateStandards(queryClient),
  })
}

export function useQualityStandardHistory(materialType?: string) {
  return useQuery({
    queryKey: ["quality-standard-history", materialType || "all"],
    queryFn: async () => (await inventoryApi.getQualityStandardHistory(materialType)).data as any[],
  })
}

export function useQualityStandardScope(params: { material_type: string; scope: string; scope_key?: string; group?: string; subgroup?: string }, enabled = true) {
  return useQuery({
    queryKey: ["quality-standard-scope", params],
    queryFn: async () => (await inventoryApi.getQualityStandardScope(params)).data as any,
    enabled: enabled && Boolean(params.material_type && params.scope),
  })
}

// Floor issue (2026-10-18): each reel sent to the slitter gets a slitting card.
export function useRecordSlittingCard() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof inventoryApi.recordSlittingCard>[1] }) => inventoryApi.recordSlittingCard(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-reel-issues"] })
      queryClient.invalidateQueries({ queryKey: ["slitting-report"] })
    },
  })
}

export function useSlittingReport(params: { date_from: string; date_to: string }) {
  return useQuery({
    queryKey: ["slitting-report", params],
    queryFn: async () => (await inventoryApi.getSlittingReport(params)).data as any,
    enabled: Boolean(params.date_from && params.date_to),
  })
}
