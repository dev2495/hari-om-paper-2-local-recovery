import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"

export const analyticsApi = {
    getDashboardOverview: (params?: any) => api.get("/api/analytics/dashboard/overview", { params }),
    getProductionTrends: (params?: any) => api.get("/api/analytics/production/trends", { params }),
    getShrinkAnalysis: (params?: any) => api.get("/api/analytics/production/shrink", { params }),
    getScrapAnalysis: (params?: any) => api.get("/api/analytics/production/scrap", { params }),
    getInventoryValuation: (params?: any) => api.get("/api/analytics/inventory/valuation", { params }),
    getSalesTrends: (params?: any) => api.get("/api/analytics/dispatch/sales-trends", { params }),
    getSupplierLoss: (params?: any) => api.get("/api/analytics/loss/supplier-loss", { params }),
    getGsmBfLoss: (params?: any) => api.get("/api/analytics/loss/gsm-bf-loss", { params }),
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
