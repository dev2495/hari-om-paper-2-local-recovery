import { useQuery } from "@tanstack/react-query"

import { api } from "@/lib/api"

function withDefinedParams(params?: Record<string, any>) {
  if (!params) return undefined
  const normalized = Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== ""),
  )
  return Object.keys(normalized).length ? normalized : undefined
}

async function getSafeData<T = any>(fn: () => Promise<{ data: T }>, fallback: T): Promise<T> {
  try {
    const { data } = await fn()
    return data ?? fallback
  } catch {
    return fallback
  }
}

function toNumber(value: any, fallback = 0) {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : fallback
}

export const analyticsApi = {
  getDashboardOverview: (params?: any) =>
    api.get("/api/analytics/dashboard/overview", { params: withDefinedParams(params) }),
  getOwnerPack: (params?: any) =>
    api.get("/api/analytics/reports/owner-pack", { params: withDefinedParams(params) }),
  getProductionTrends: (params?: any) =>
    api.get("/api/analytics/production/trends", { params: withDefinedParams(params) }),
  getShrinkAnalysis: (params?: any) =>
    api.get("/api/analytics/production/shrink", { params: withDefinedParams(params) }),
  getScrapAnalysis: (params?: any) =>
    api.get("/api/analytics/production/scrap", { params: withDefinedParams(params) }),
  getInventoryValuation: (params?: any) =>
    api.get("/api/analytics/inventory/valuation", { params: withDefinedParams(params) }),
  getSalesTrends: (params?: any) =>
    api.get("/api/analytics/dispatch/sales-trends", { params: withDefinedParams(params) }),
  getSupplierLoss: (params?: any) =>
    api.get("/api/analytics/loss/supplier-loss", { params: withDefinedParams(params) }),
  getGsmBfLoss: (params?: any) =>
    api.get("/api/analytics/loss/gsm-bf-loss", { params: withDefinedParams(params) }),
  // Deep-cut reports introduced by the reports-suite redesign
  getMachineUtilization: (params?: any) =>
    api.get("/api/analytics/deep/machine-utilization", { params: withDefinedParams(params) }),
  getCustomer360: (params?: any) =>
    api.get("/api/analytics/deep/customer-360", { params: withDefinedParams(params) }),
  getOperatorProductivity: (params?: any) =>
    api.get("/api/analytics/deep/operator-productivity", { params: withDefinedParams(params) }),
  getLeadtimeAnatomy: (params?: any) =>
    api.get("/api/analytics/deep/leadtime-anatomy", { params: withDefinedParams(params) }),
  getScrapCostLadder: (params?: any) =>
    api.get("/api/analytics/deep/scrap-cost-ladder", { params: withDefinedParams(params) }),
  getItemVelocity: (params?: any) =>
    api.get("/api/analytics/deep/item-velocity", { params: withDefinedParams(params) }),
  getSchedulerStatus: () =>
    api.get("/api/analytics/scheduler/status"),
}

export function useDashboardOverview(plant?: string) {
  return useQuery({
    queryKey: ["analytics", "dashboard", plant],
    queryFn: async () => {
      const { data } = await analyticsApi.getDashboardOverview(plant ? { plant } : undefined)
      return data
    },
  })
}

export function useProductionTrends(startDate: string, endDate: string, plant?: string) {
  return useQuery({
    queryKey: ["analytics", "production", "trends", startDate, endDate, plant],
    queryFn: async () => {
      const { data } = await analyticsApi.getProductionTrends({ start_date: startDate, end_date: endDate, plant })
      return data
    },
    enabled: !!startDate && !!endDate,
  })
}

export function useShrinkAnalysis(startDate: string, endDate: string, plant?: string) {
  return useQuery({
    queryKey: ["analytics", "production", "shrink", startDate, endDate, plant],
    queryFn: async () => {
      const { data } = await analyticsApi.getShrinkAnalysis({ start_date: startDate, end_date: endDate, plant })
      return data
    },
    enabled: !!startDate && !!endDate,
  })
}

export function useScrapAnalysis(startDate: string, endDate: string, plant?: string) {
  return useQuery({
    queryKey: ["analytics", "production", "scrap", startDate, endDate, plant],
    queryFn: async () => {
      const { data } = await analyticsApi.getScrapAnalysis({ start_date: startDate, end_date: endDate, plant })
      return data
    },
    enabled: !!startDate && !!endDate,
  })
}

export function useInventoryValuation(plant?: string) {
  return useQuery({
    queryKey: ["analytics", "inventory", "valuation", plant],
    queryFn: async () => {
      const { data } = await analyticsApi.getInventoryValuation(plant ? { plant } : undefined)
      return data
    },
  })
}

export function useSalesTrends(startDate: string, endDate: string, plant?: string) {
  return useQuery({
    queryKey: ["analytics", "sales", "trends", startDate, endDate, plant],
    queryFn: async () => {
      const { data } = await analyticsApi.getSalesTrends({ start_date: startDate, end_date: endDate, plant })
      return data
    },
    enabled: !!startDate && !!endDate,
  })
}

export function useSupplierLoss(startDate: string, endDate: string, plant?: string) {
  return useQuery({
    queryKey: ["analytics", "loss", "supplier", startDate, endDate, plant],
    queryFn: async () => {
      const { data } = await analyticsApi.getSupplierLoss({ start_date: startDate, end_date: endDate, plant })
      return data
    },
    enabled: !!startDate && !!endDate,
  })
}

export function useGsmBfLoss(startDate: string, endDate: string, plant?: string) {
  return useQuery({
    queryKey: ["analytics", "loss", "gsm-bf", startDate, endDate, plant],
    queryFn: async () => {
      const { data } = await analyticsApi.getGsmBfLoss({ start_date: startDate, end_date: endDate, plant })
      return data
    },
    enabled: !!startDate && !!endDate,
  })
}

function normalizeSalesReport(raw: any, params: any) {
  if (raw?.summary && Array.isArray(raw?.series)) {
    return {
      ...raw,
      available_range: raw.available_range || {
        start_date: params?.startDate || params?.start_date || null,
        end_date: params?.endDate || params?.end_date || null,
      },
    }
  }

  const daily = Array.isArray(raw?.daily) ? raw.daily : Array.isArray(raw) ? raw : []
  const series = daily.map((row: any, index: number) => ({
    label: row.label || row.date || row.day || `P${index + 1}`,
    orders_created: toNumber(row.orders_created ?? row.order_count ?? row.orders ?? row.count),
    released_or_better: toNumber(row.released_or_better ?? row.released ?? row.released_orders),
    orders_closed: toNumber(row.orders_closed ?? row.closed ?? row.closed_orders),
    dispatch_qty: toNumber(row.dispatch_qty ?? row.value ?? row.revenue ?? row.qty),
  }))

  const summary = {
    backlog_orders: toNumber(raw?.backlog_orders),
    closed_orders: toNumber(raw?.closed_orders),
    delayed_orders: toNumber(raw?.delayed_orders),
    otif_percent: toNumber(raw?.otif_percent),
    release_to_dispatch_days: toNumber(raw?.release_to_dispatch_days),
  }

  if (!summary.closed_orders && series.length) {
    summary.closed_orders = series.reduce((sum: number, row: any) => sum + toNumber(row.orders_closed), 0)
  }
  if (!summary.backlog_orders && series.length) {
    summary.backlog_orders = series.reduce(
      (sum: number, row: any) => sum + Math.max(0, toNumber(row.orders_created) - toNumber(row.orders_closed)),
      0,
    )
  }

  return {
    summary,
    series,
    delayed_rows: Array.isArray(raw?.delayed_rows) ? raw.delayed_rows : Array.isArray(raw?.delayed_orders) ? raw.delayed_orders : [],
    available_range: {
      start_date: params?.startDate || params?.start_date || null,
      end_date: params?.endDate || params?.end_date || null,
    },
  }
}

function normalizePlantCompare(raw: any) {
  const rows = Array.isArray(raw?.rows)
    ? raw.rows
    : Array.isArray(raw?.by_plant)
      ? raw.by_plant
      : Array.isArray(raw)
        ? raw
        : []

  return rows.map((row: any, index: number) => ({
    plant_id: row.plant_id || row.id || `plant-${index}`,
    plant_code: row.plant_code || row.code || row.plant || `P${index + 1}`,
    plant_name: row.plant_name || row.name || row.plant_code || row.code || `Plant ${index + 1}`,
    job_cards: toNumber(row.job_cards ?? row.active_jobs),
    inventory_value: toNumber(row.inventory_value ?? row.stock_value ?? row.inventory),
    ready_job_count: toNumber(row.ready_job_count ?? row.ready_jobs),
    blocked_qty: toNumber(row.blocked_qty ?? row.blocked_jobs),
    delayed_orders: toNumber(row.delayed_orders ?? row.delayed),
  }))
}

export function useSalesReport(params: {
  startDate: string
  endDate: string
  plant?: string
  granularity?: "day" | "week" | "month"
}) {
  return useQuery({
    queryKey: ["analytics", "sales-report", params],
    queryFn: async () => {
      const { data } = await analyticsApi.getSalesTrends({
        start_date: params.startDate,
        end_date: params.endDate,
        plant: params.plant,
        granularity: params.granularity,
      })
      return normalizeSalesReport(data, params)
    },
    enabled: !!params?.startDate && !!params?.endDate,
  })
}

export function usePlantCompareReport(params: {
  startDate: string
  endDate: string
  plant?: string
  granularity?: "day" | "week" | "month"
}) {
  return useQuery({
    queryKey: ["analytics", "plant-compare-report", params],
    queryFn: async () => {
      const { data } = await analyticsApi.getDashboardOverview({
        start_date: params.startDate,
        end_date: params.endDate,
        plant: params.plant,
        granularity: params.granularity,
      })
      return {
        rows: normalizePlantCompare(data),
        available_range: data?.available_range || {
          start_date: params.startDate,
          end_date: params.endDate,
        },
      }
    },
    enabled: !!params?.startDate && !!params?.endDate,
  })
}

export function useExceptionReport(params: {
  startDate: string
  endDate: string
  plant?: string
  granularity?: "day" | "week" | "month"
}) {
  return useQuery({
    queryKey: ["analytics", "exception-report", params],
    queryFn: async () => {
      const queryParams = {
        start_date: params.startDate,
        end_date: params.endDate,
        plant: params.plant,
        granularity: params.granularity,
      }

      const [overview, inventory] = await Promise.all([
        getSafeData(() => analyticsApi.getDashboardOverview(queryParams), {}),
        getSafeData(() => analyticsApi.getInventoryValuation(queryParams), {}),
      ])

      const delayedOrders = Array.isArray((overview as any)?.delayed_orders)
        ? (overview as any).delayed_orders
        : Array.isArray((overview as any)?.delayed_rows)
          ? (overview as any).delayed_rows
          : []
      const blockedJobs = Array.isArray((overview as any)?.blocked_jobs)
        ? (overview as any).blocked_jobs
        : Array.isArray((overview as any)?.blocked_rows)
          ? (overview as any).blocked_rows
          : []
      const activeHolds = Array.isArray((overview as any)?.active_holds) ? (overview as any).active_holds : []
      const lowStock = Array.isArray((inventory as any)?.low_stock)
        ? (inventory as any).low_stock
        : Array.isArray((inventory as any)?.low_stock_items)
          ? (inventory as any).low_stock_items
          : []
      const overstock = Array.isArray((inventory as any)?.overstock)
        ? (inventory as any).overstock
        : Array.isArray((inventory as any)?.overstock_items)
          ? (inventory as any).overstock_items
          : []

      return {
        summary: {
          delayed_orders: toNumber((overview as any)?.delayed_orders, delayedOrders.length),
          low_stock_items: toNumber((inventory as any)?.low_stock_items, lowStock.length),
          overstock_items: toNumber((inventory as any)?.overstock_items, overstock.length),
          blocked_jobs: toNumber((overview as any)?.blocked_jobs, blockedJobs.length),
          active_qc_holds: toNumber((overview as any)?.active_qc_holds, activeHolds.length),
        },
        delayed_orders: delayedOrders,
        low_stock: lowStock,
        overstock,
        blocked_jobs: blockedJobs,
        active_holds: activeHolds,
        available_range: (overview as any)?.available_range || {
          start_date: params.startDate,
          end_date: params.endDate,
        },
      }
    },
    enabled: !!params?.startDate && !!params?.endDate,
  })
}

export function useMachineUtilization(params?: { startDate?: string; endDate?: string; plant?: string }, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["analytics", "deep", "machine-utilization", params || {}],
    queryFn: async () => {
      const { data } = await analyticsApi.getMachineUtilization({
        start_date: params?.startDate,
        end_date: params?.endDate,
        plant: params?.plant,
      })
      return data || { day_labels: [], hour_labels: [], machines: [] }
    },
    enabled: options?.enabled !== false,
  })
}

export function useCustomer360(params?: { startDate?: string; endDate?: string; plant?: string }, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["analytics", "deep", "customer-360", params || {}],
    queryFn: async () => {
      const { data } = await analyticsApi.getCustomer360({
        start_date: params?.startDate,
        end_date: params?.endDate,
        plant: params?.plant,
      })
      return data || { summary: {}, rows: [] }
    },
    enabled: options?.enabled !== false,
  })
}

export function useOperatorProductivity(params?: { startDate?: string; endDate?: string; plant?: string }, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["analytics", "deep", "operator-productivity", params || {}],
    queryFn: async () => {
      const { data } = await analyticsApi.getOperatorProductivity({
        start_date: params?.startDate,
        end_date: params?.endDate,
        plant: params?.plant,
      })
      return data || { summary: {}, rows: [] }
    },
    enabled: options?.enabled !== false,
  })
}

export function useLeadtimeAnatomy(params?: { startDate?: string; endDate?: string; plant?: string }, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["analytics", "deep", "leadtime-anatomy", params || {}],
    queryFn: async () => {
      const { data } = await analyticsApi.getLeadtimeAnatomy({
        start_date: params?.startDate,
        end_date: params?.endDate,
        plant: params?.plant,
      })
      return data || { stages: [], total_average_days: 0, samples: 0 }
    },
    enabled: options?.enabled !== false,
  })
}

export function useScrapCostLadder(params?: { startDate?: string; endDate?: string; plant?: string }, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["analytics", "deep", "scrap-cost-ladder", params || {}],
    queryFn: async () => {
      const { data } = await analyticsApi.getScrapCostLadder({
        start_date: params?.startDate,
        end_date: params?.endDate,
        plant: params?.plant,
      })
      return data || { summary: {}, rows: [] }
    },
    enabled: options?.enabled !== false,
  })
}

export function useItemVelocity(params?: { horizonDays?: number; plant?: string }, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["analytics", "deep", "item-velocity", params || {}],
    queryFn: async () => {
      const { data } = await analyticsApi.getItemVelocity({
        horizon_days: params?.horizonDays || 30,
        plant: params?.plant,
      })
      return data || { summary: {}, rows: [] }
    },
    enabled: options?.enabled !== false,
  })
}

export function useSchedulerStatus(options?: { enabled?: boolean; refetchInterval?: number }) {
  return useQuery({
    queryKey: ["scheduler-status"],
    queryFn: async () => {
      const { data } = await analyticsApi.getSchedulerStatus()
      return data || { enabled: false, jobs: {}, next_runs: {} }
    },
    enabled: options?.enabled !== false,
    refetchInterval: options?.refetchInterval ?? 60_000,
  })
}

export function useOwnerPack(params?: any, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["analytics", "owner-pack", params || {}],
    queryFn: async () => {
      const { data } = await analyticsApi.getOwnerPack(params)
      return data
    },
    enabled: options?.enabled !== false,
  })
}
