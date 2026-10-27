"use client"

// Queries and mutations behind the job card page, the floor forms and the QC desk. Query keys are the
// same ones the older entry desk used, so every screen on a card refreshes together.

import { useCallback, useMemo, useRef, useState } from "react"
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query"

import { productionApi } from "@/lib/api"
import { command, entryApiForPlant, errorText } from "@/lib/season-api"

export const cardKeys = {
  flow: (id: string) => ["continuous-flow", id],
  entries: (id: string, stage?: string, page = 0) => ["continuous-entries", id, stage, page],
  effects: (id: string) => ["continuous-effects", id],
  plan: (id: string) => ["job-card-plan", id],
  history: (id: string) => ["job-card-history", id],
  lifecycle: (id: string) => ["job-card-lifecycle", id],
  card: (id: string) => ["planning-job-card", id],
}

export const useEntryApi = (card: any) => useMemo(() => entryApiForPlant(String(card?.plant_id || "")), [card?.plant_id])

export function useCardFlow(card: any, enabled = true) {
  const api = useEntryApi(card)
  return useQuery({
    queryKey: cardKeys.flow(String(card?.id)),
    queryFn: async () => (await api.flow(String(card.id))).data,
    enabled: Boolean(card?.id) && enabled,
    refetchInterval: 15000,
  })
}

export function useStageEntries(card: any, stage?: string, page = 0, enabled = true) {
  const api = useEntryApi(card)
  return useQuery({
    queryKey: cardKeys.entries(String(card?.id), stage, page),
    queryFn: async () => (await api.list(String(card.id), stage, page * 50, 50)).data as { entries: any[]; total: number },
    enabled: Boolean(card?.id) && enabled,
  })
}

/** Runs of every logged stage at once (one request per stage, each keyed like the stage tab). */
export function useAllStageEntries(card: any, stages: string[], enabled = true) {
  const api = useEntryApi(card)
  const results = useQueries({
    queries: stages.map((stage) => ({
      queryKey: cardKeys.entries(String(card?.id), stage, 0),
      queryFn: async () => (await api.list(String(card.id), stage, 0, 100)).data as { entries: any[]; total: number },
      enabled: Boolean(card?.id) && enabled,
    })),
  })
  const entries = useMemo(() => {
    const all = results.flatMap((r) => r.data?.entries || [])
    return all.sort((a: any, b: any) => String(b.created_at || "").localeCompare(String(a.created_at || "")) || b.entry_no - a.entry_no)
  }, [results])
  return {
    entries,
    total: results.reduce((sum, r) => sum + Number(r.data?.total || 0), 0),
    isLoading: results.some((r) => r.isLoading),
    isError: results.some((r) => r.isError),
    refetch: () => Promise.all(results.map((r) => r.refetch())),
  }
}

export function useCardMasters(card: any) {
  const api = useEntryApi(card)
  const plant = String(card?.plant_id || "")
  const employees = useQuery({ queryKey: ["continuous-employees", plant], queryFn: async () => (await api.employees()).data, enabled: Boolean(plant) })
  const machines = useQuery({ queryKey: ["continuous-machines", plant], queryFn: async () => (await api.machines()).data, enabled: Boolean(plant) })
  const activeEmployees: any[] = useMemo(() => (employees.data || []).filter((e: any) => e.active !== false && e.is_active !== false), [employees.data])
  const machineName = useCallback(
    (id: any) => {
      const m = (machines.data || []).find((row: any) => String(row.id) === String(id))
      return m ? m.name || m.code : ""
    },
    [machines.data],
  )
  return { employees, machines, activeEmployees, machineName }
}

export function useCardEffects(card: any, enabled = true) {
  const api = useEntryApi(card)
  return useQuery({ queryKey: cardKeys.effects(String(card?.id)), queryFn: async () => (await api.effects(String(card.id))).data, enabled: Boolean(card?.id) && enabled, refetchInterval: 15000 })
}

export function useCardPlan(card: any, enabled = true) {
  return useQuery({
    queryKey: cardKeys.plan(String(card?.id)),
    queryFn: async () => (await productionApi.getJobCardPlan(String(card.id), card?.plant_id ? String(card.plant_id) : undefined)).data,
    enabled: Boolean(card?.id) && enabled,
  })
}

export function useCardHistory(card: any, enabled = true) {
  return useQuery({
    queryKey: cardKeys.history(String(card?.id)),
    queryFn: async () => (await productionApi.getJobCardHistory(String(card.id), card?.plant_id ? String(card.plant_id) : undefined)).data,
    enabled: Boolean(card?.id) && enabled,
  })
}

/** Refresh everything that shows this card after a write. */
export function useRefreshCard(cardId: string) {
  const cache = useQueryClient()
  return useCallback(
    () =>
      Promise.all([
        cache.invalidateQueries({ queryKey: ["continuous-flow", cardId] }),
        cache.invalidateQueries({ queryKey: ["continuous-entries", cardId] }),
        cache.invalidateQueries({ queryKey: ["planning-job-card", cardId] }),
        cache.invalidateQueries({ queryKey: ["continuous-effects", cardId] }),
        cache.invalidateQueries({ queryKey: ["job-card-plan", cardId] }),
        cache.invalidateQueries({ queryKey: ["job-card-history", cardId] }),
        cache.invalidateQueries({ queryKey: ["job-card-lifecycle", cardId] }),
        cache.invalidateQueries({ queryKey: ["planning-job-cards"] }),
      ]),
    [cache, cardId],
  )
}

/**
 * One request id per distinct body: a retry of the same form resends the same command, so the server
 * replays it instead of writing twice (expected_version + request_id idempotency).
 */
export function useStableCommand() {
  const pending = useRef<{ fingerprint: string; body: any } | null>(null)
  // `scope` keeps two different rows apart when their bodies happen to be identical (same version, same reason).
  const stableCommand = useCallback((body: any, scope = "") => {
    const fingerprint = `${scope}|${JSON.stringify(body)}`
    if (!pending.current || pending.current.fingerprint !== fingerprint) pending.current = { fingerprint, body: command(body) }
    return pending.current.body
  }, [])
  const reset = useCallback(() => {
    pending.current = null
  }, [])
  return { stableCommand, reset }
}

/** A mutation that reads the server's words on failure and refreshes the card on success. */
export function useCardMutation(cardId: string) {
  const refresh = useRefreshCard(cardId)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const mutation = useMutation({
    mutationFn: async (action: () => Promise<any>) => action(),
    onError: (e) => {
      setError(errorText(e))
      setNotice("")
    },
    onSuccess: async () => {
      setError("")
      await refresh()
    },
  })
  return { mutation, error, setError, notice, setNotice, refresh }
}
