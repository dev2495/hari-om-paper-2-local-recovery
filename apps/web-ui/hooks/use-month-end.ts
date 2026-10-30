import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { monthEndApi, type MonthEndLimit } from "@/lib/api-month-end"

const isPlant = (plantId?: string | null) => Boolean(plantId && plantId !== "ALL")

export function useMonthEndMonths(plantId?: string | null) {
  return useQuery({
    queryKey: ["month-end", "months", plantId],
    queryFn: async () => (await monthEndApi.months(String(plantId))).data,
    enabled: isPlant(plantId),
    staleTime: 30_000,
  })
}

export function useMonthEndOverview(month?: string | null, plantId?: string | null) {
  return useQuery({
    queryKey: ["month-end", "overview", plantId, month],
    queryFn: async () => (await monthEndApi.overview(String(month), String(plantId))).data,
    enabled: isPlant(plantId) && Boolean(month),
    staleTime: 15_000,
  })
}

export function useMonthEndYear(fy: string | undefined, plantId?: string | null, enabled = true) {
  return useQuery({
    queryKey: ["month-end", "year", plantId, fy || "current"],
    queryFn: async () => (await monthEndApi.year(fy, String(plantId))).data,
    enabled: enabled && isPlant(plantId),
    staleTime: 60_000,
  })
}

export function useMonthEndSources(month: string | null | undefined, itemCode: string | null | undefined, itemId: string | null | undefined, plantId?: string | null) {
  return useQuery({
    queryKey: ["month-end", "sources", plantId, month, itemCode, itemId],
    queryFn: async () => (await monthEndApi.sources(String(month), String(itemCode), itemId, String(plantId))).data,
    enabled: isPlant(plantId) && Boolean(month && itemCode),
  })
}

function useRefreshMonthEnd() {
  const queryClient = useQueryClient()
  return () => {
    queryClient.invalidateQueries({ queryKey: ["month-end"] })
    queryClient.invalidateQueries({ queryKey: ["books-state"] })
  }
}

export function useSaveMonthNote(plantId?: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: { month: string; item_code: string; item_id?: string | null; item_name?: string | null; note: string }) =>
      monthEndApi.saveNote(body, String(plantId)),
    onSuccess: (_data, body) => {
      queryClient.invalidateQueries({ queryKey: ["month-end", "overview", plantId, body.month] })
      queryClient.invalidateQueries({ queryKey: ["month-end", "sources", plantId, body.month] })
    },
  })
}

export function useCloseMonth(plantId?: string | null) {
  const refresh = useRefreshMonthEnd()
  return useMutation({
    mutationFn: (body: { month: string; note?: string | null }) => monthEndApi.close(body, String(plantId)).then((response) => response.data),
    onSuccess: refresh,
  })
}

export function useReopenMonth(plantId?: string | null) {
  const refresh = useRefreshMonthEnd()
  return useMutation({
    mutationFn: (body: { month: string; reason: string }) => monthEndApi.reopen(body, String(plantId)).then((response) => response.data),
    onSuccess: refresh,
  })
}

export function useUsageLimits(plantId?: string | null) {
  return useQuery({
    queryKey: ["month-end", "limits", plantId],
    queryFn: async () => (await monthEndApi.limits(String(plantId))).data,
    enabled: isPlant(plantId),
  })
}

export function useSaveUsageLimits(plantId?: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (limits: Array<Pick<MonthEndLimit, "material_type" | "normal_wastage_pct" | "allowed_gap_pct" | "min_gap">>) =>
      monthEndApi.saveLimits(limits, String(plantId)).then((response) => response.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["month-end"] }),
  })
}
