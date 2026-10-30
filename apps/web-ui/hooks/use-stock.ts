"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { useAuth } from "@/context/AuthContext"
import { useCallback } from "react"

import { stockApi, type CorrectionInput, type CountEntry, type CountStart, type LocationInput, type RackPayload, type RackView } from "@/lib/api-stock"

/** Stock stream hooks (client 2026-10-28). Keys carry the open plant so a plant switch never shows another plant's stock. */

function usePlantKey() {
  const { activePlant } = useAuth()
  return activePlant || "none"
}

/** These pages work on one plant: the "All plants" view asks the person to pick one first. */
export function useSinglePlant() {
  const { activePlant } = useAuth()
  return Boolean(activePlant && activePlant !== "ALL")
}

export function useLocationsOverview() {
  const plant = usePlantKey()
  const single = useSinglePlant()
  return useQuery({ queryKey: ["stock", plant, "locations"], queryFn: stockApi.locationsOverview, enabled: single })
}

export function useLocation(id: string | undefined) {
  const plant = usePlantKey()
  const single = useSinglePlant()
  return useQuery({ queryKey: ["stock", plant, "location", id], queryFn: () => stockApi.location(String(id)), enabled: single && Boolean(id) })
}

export function useLots(ids: string[]) {
  const plant = usePlantKey()
  const single = useSinglePlant()
  return useQuery({ queryKey: ["stock", plant, "lots", ids.join(",")], queryFn: () => stockApi.lots(ids), enabled: single && ids.length > 0 })
}

/** Parchment coils the by-weight issue will take, with their racks (only for one plant). */
export function useParchmentCoils(itemId: string | undefined, qtyKg?: number) {
  const plant = usePlantKey()
  const single = useSinglePlant()
  const qty = qtyKg && qtyKg > 0 ? Math.round(qtyKg * 1000) / 1000 : undefined
  return useQuery({ queryKey: ["stock", plant, "parchment-coils", itemId, qty], queryFn: () => stockApi.parchmentCoils(String(itemId), qty), enabled: single && Boolean(itemId) })
}

export function useCounts() {
  const plant = usePlantKey()
  const single = useSinglePlant()
  return useQuery({ queryKey: ["stock", plant, "counts"], queryFn: stockApi.counts, enabled: single })
}

export function useCount(id: string | undefined, refetchInterval?: number) {
  const plant = usePlantKey()
  const single = useSinglePlant()
  return useQuery({ queryKey: ["stock", plant, "count", id], queryFn: () => stockApi.count(String(id)), enabled: single && Boolean(id), refetchInterval })
}

export function useRack(id: string | undefined, rack: string | undefined) {
  const plant = usePlantKey()
  const single = useSinglePlant()
  return useQuery({ queryKey: ["stock", plant, "count", id, "rack", rack], queryFn: () => stockApi.rack(String(id), String(rack)), enabled: single && Boolean(id && rack) })
}

/**
 * Write a scan's answer straight into the rack page's cache (the counter and lists move at once, even when
 * the refetch that follows is slow or fails): the rack's progress, the line, and the expected lot it ticks.
 */
export function usePatchRack(id: string | undefined, rack: string | undefined) {
  const plant = usePlantKey()
  const client = useQueryClient()
  return useCallback((change: { rack?: RackView | null; entry?: CountEntry | null; removedEntryId?: string }) => {
    client.setQueryData<RackPayload>(["stock", plant, "count", id, "rack", rack], (current) => {
      if (!current) return current
      let entries = current.entries
      let expected = current.expected
      if (change.removedEntryId) {
        entries = entries.filter((row) => row.id !== change.removedEntryId)
        expected = expected.map((row) => (row.entry_id === change.removedEntryId ? { ...row, entry_id: null, counted_rack: null, counted_qty: null } : row))
      }
      const entry = change.entry
      if (entry) {
        const here = entry.rack === current.rack.key
        entries = here ? [entry, ...entries.filter((row) => row.id !== entry.id)] : entries.filter((row) => row.id !== entry.id)
        expected = expected.map((row) => (row.id === entry.entity_id ? { ...row, entry_id: entry.id, counted_rack: entry.rack, counted_qty: entry.counted_qty } : row))
      }
      return { ...current, rack: change.rack ? { ...current.rack, ...change.rack } : current.rack, entries, expected }
    })
  }, [client, plant, id, rack])
}

export function useMonthFigures(month: string) {
  const plant = usePlantKey()
  const single = useSinglePlant()
  return useQuery({ queryKey: ["stock", plant, "month-figures", month], queryFn: () => stockApi.monthFigures(month), enabled: single && Boolean(month) })
}

export function useItemSources(itemId: string | undefined, month: string) {
  const plant = usePlantKey()
  return useQuery({ queryKey: ["stock", plant, "sources", itemId, month], queryFn: () => stockApi.itemSources(String(itemId), month), enabled: Boolean(itemId && month) })
}

export function useCorrections(status = "ALL") {
  const plant = usePlantKey()
  const single = useSinglePlant()
  return useQuery({ queryKey: ["stock", plant, "corrections", status], queryFn: () => stockApi.corrections(status), enabled: single })
}

/** Every write refreshes all stock views of the plant (counts, locations, book, corrections). */
function useStockMutation<TVars, TResult>(fn: (vars: TVars) => Promise<TResult>) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["stock"] })
      // Dropdowns and issue desks read the plain location list (pick-from); keep them in step.
      void client.invalidateQueries({ queryKey: ["inventory-locations"] })
    },
  })
}

export const useStartCount = () => useStockMutation((body: CountStart) => stockApi.startCount(body))
export const useSubmitCount = () => useStockMutation(({ id, note }: { id: string; note?: string }) => stockApi.submit(id, note))
export const useApproveCount = () => useStockMutation(({ id, note }: { id: string; note?: string }) => stockApi.approve(id, note))
export const useSendBackCount = () => useStockMutation(({ id, note, racks }: { id: string; note: string; racks: string[] }) => stockApi.sendBack(id, note, racks))
export const useCancelCount = () => useStockMutation(({ id, note }: { id: string; note?: string }) => stockApi.cancel(id, note))
export const useDecide = () => useStockMutation(({ id, entryId, decision }: { id: string; entryId: string; decision: "LEAVE_AS_USED" | "ADD_ON_QC_HOLD" }) => stockApi.decide(id, entryId, decision))
export const useRackAction = () => useStockMutation(({ id, rack, action }: { id: string; rack: string; action: "start" | "done" | "reopen" }) => stockApi.rackAction(id, rack, action))
export const useRaiseCorrection = () => useStockMutation((body: CorrectionInput) => stockApi.raiseCorrection(body))
export const useApproveCorrection = () => useStockMutation(({ id, note }: { id: string; note?: string }) => stockApi.approveCorrection(id, note))
export const useRejectCorrection = () => useStockMutation(({ id, note }: { id: string; note: string }) => stockApi.rejectCorrection(id, note))
export const useCreateLocation = () => useStockMutation((body: LocationInput & { code: string; warehouse: string }) => stockApi.createLocation(body))
export const useUpdateLocation = () => useStockMutation(({ id, body }: { id: string; body: LocationInput }) => stockApi.updateLocation(id, body))
export const usePutAwayAll = () => useStockMutation((toLocationId?: string) => stockApi.putAwayAll(toLocationId))
