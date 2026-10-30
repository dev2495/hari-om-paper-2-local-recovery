"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { useAuth } from "@/context/AuthContext"
import { businessDate } from "@/lib/business-date"
import { apiErrorText, rmCalendarApi, type ArrivalInput, type QueueKey, type SendChannel } from "@/lib/api-rm-calendar"

const ROOT = "rm-calendar"

function usePlantReady() {
  const { activePlant } = useAuth()
  return { activePlant, ready: Boolean(activePlant && activePlant !== "ALL") }
}

/** Refresh everything the calendar, the purchase queue and the PO page read. */
export function useRefreshPurchasing() {
  const client = useQueryClient()
  return () => {
    client.invalidateQueries({ queryKey: [ROOT] })
    client.invalidateQueries({ queryKey: ["purchase-v2"] })
  }
}

export function useRmCalendar(weeks: number) {
  const { activePlant, ready } = usePlantReady()
  return useQuery({
    queryKey: [ROOT, "calendar", activePlant, weeks],
    enabled: ready,
    staleTime: 30_000,
    queryFn: async () => (await rmCalendarApi.calendar(weeks)).data,
  })
}

export function usePurchaseQueue(queue: QueueKey, q: string, page: number, pageSize: number) {
  const { activePlant, ready } = usePlantReady()
  return useQuery({
    queryKey: ["purchase-v2", "queue", activePlant, queue, q, page, pageSize],
    enabled: ready,
    queryFn: async () => (await rmCalendarApi.queue({ queue, q: q || undefined, limit: pageSize, offset: (page - 1) * pageSize })).data,
  })
}

/** Counts for the purchase-desk tabs (and the calendar's "Drafts to send" tile). */
export function useQueueCounts() {
  const { activePlant, ready } = usePlantReady()
  return useQuery({
    queryKey: ["purchase-v2", "queue-counts", activePlant],
    enabled: ready,
    staleTime: 30_000,
    queryFn: async () => (await rmCalendarApi.queue({ queue: "all", limit: 1 })).data.summary,
  })
}

/** Arrivals proposed and not yet approved by the Owner, over the next year (approvals inbox). */
export function useProposedArrivals() {
  const { activePlant, ready } = usePlantReady()
  return useQuery({
    queryKey: [ROOT, "proposed", activePlant],
    enabled: ready,
    queryFn: async () => {
      const today = businessDate()
      const until = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)) + 365)).toISOString().slice(0, 10)
      const { data } = await rmCalendarApi.supply(today, until)
      const items = Object.fromEntries(data.items.map((row) => [row.item_id, row]))
      return data.arrivals.filter((row) => row.state === "PROPOSED" && row.entry_id).map((row) => ({ ...row, item: items[row.item_id] }))
    },
  })
}

export function useExpectedArrivals() {
  const { activePlant, ready } = usePlantReady()
  return useQuery({
    queryKey: [ROOT, "expected", activePlant],
    enabled: ready,
    queryFn: async () => (await rmCalendarApi.expectedArrivals()).data,
  })
}

export function useProposeArrivals() {
  const refresh = useRefreshPurchasing()
  return useMutation({ mutationFn: (entries: ArrivalInput[]) => rmCalendarApi.propose(entries), onSuccess: refresh })
}

export type ArrivalUpdateResult = { needs_po_change: false; data: unknown } | { needs_po_change: true; message: string }

/**
 * Move / change an arrival. "PO already sent — change the PO?" is a question, not a failure: it
 * comes back as ``needs_po_change`` so the page asks first and no error banner appears.
 */
export function useUpdateArrival() {
  const refresh = useRefreshPurchasing()
  return useMutation({
    mutationFn: async ({ id, ...body }: { id: string } & Partial<ArrivalInput> & { confirm_po_change?: boolean }): Promise<ArrivalUpdateResult> => {
      try {
        return { needs_po_change: false, data: (await rmCalendarApi.update(id, body)).data }
      } catch (failure: any) {
        const message = apiErrorText(failure)
        if (failure?.response?.status === 409 && message.startsWith("PO already sent")) return { needs_po_change: true, message }
        throw failure
      }
    },
    onSuccess: (result) => { if (!result.needs_po_change) refresh() },
  })
}

export function useCancelArrival() {
  const refresh = useRefreshPurchasing()
  return useMutation({ mutationFn: ({ id, reason }: { id: string; reason?: string }) => rmCalendarApi.cancel(id, reason), onSuccess: refresh })
}

export function useApproveArrivals() {
  const refresh = useRefreshPurchasing()
  return useMutation({
    mutationFn: async ({ entryIds, supplierIds }: { entryIds: string[]; supplierIds: string[] }) => (await rmCalendarApi.approve(entryIds, supplierIds)).data,
    onSuccess: refresh,
  })
}

export function useSuggestArrivals() {
  return useMutation({ mutationFn: async (body: { weeks: number; material_class?: string }) => (await rmCalendarApi.suggest(body)).data.items })
}

export function useSendOrder() {
  const refresh = useRefreshPurchasing()
  return useMutation({
    mutationFn: async ({ id, version, channel, note }: { id: string; version: number; channel: SendChannel; note?: string }) =>
      (await rmCalendarApi.send(id, { expected_version: version, channel, note })).data,
    onSuccess: refresh,
  })
}

export function useVendorConfirm() {
  const refresh = useRefreshPurchasing()
  return useMutation({
    mutationFn: async ({ id, version, rows, note }: { id: string; version: number; rows: Array<{ schedule_id: string; confirmed_date?: string }>; note?: string }) =>
      (await rmCalendarApi.vendorConfirm(id, { expected_version: version, rows, note })).data,
    onSuccess: refresh,
  })
}
