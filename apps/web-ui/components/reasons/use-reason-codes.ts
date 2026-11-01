"use client"

import { useCallback, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"

import { api } from "@/lib/api"

import { EMPTY_REASON, reasonComplete, reasonPayload, reasonProblem, reasonText, reasonIsActive, type ReasonRow, type ReasonValue } from "./reason-rules"

export type ReasonCategory = {
  key: string
  label: string
  group: string
  used_in: string[]
  owner_only: boolean
  linked: boolean
  standard_codes: string[]
  active?: number
  total?: number
}

const usablePlant = (plantId?: string | null) => {
  const value = String(plantId || "").trim()
  return value && value.toUpperCase() !== "ALL" ? value : undefined
}

/** Active codes of one reason list for a plant (the record's plant; else the selected plant). */
export function useReasonList(category: string, plantId?: string | null, enabled = true) {
  const plant = usablePlant(plantId)
  return useQuery({
    queryKey: ["reason-codes", "picker", category, plant || "selected"],
    enabled: enabled && Boolean(category),
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await api.get("/api/master/reason-codes", { params: { category }, headers: plant ? { "X-Plant-ID": plant } : undefined })
      return (Array.isArray(data) ? data : []).filter((row: ReasonRow) => row.category === category && reasonIsActive(row)) as ReasonRow[]
    },
  })
}

/** Every reason list with its group and where it is used (Masters › Reason codes). */
export function useReasonCategories() {
  return useQuery({
    queryKey: ["reason-codes", "categories"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await api.get("/api/master/reason-codes/categories")
      return (Array.isArray(data) ? data : []) as ReasonCategory[]
    },
  })
}

/**
 * State for one reason choice: value, validation and the request body.
 *
 *   const reason = useReasonChoice("QC_HOLD", plantId)
 *   <ReasonPicker category="QC_HOLD" plantId={plantId} value={reason.value} onChange={reason.setValue} showErrors={reason.touched} />
 *   if (!reason.validate()) return
 *   api.post(url, { ...other, ...reason.payload("reason") })
 */
export function useReasonChoice(category: string, plantId?: string | null, options?: { required?: boolean; enabled?: boolean }) {
  const required = options?.required !== false
  const list = useReasonList(category, plantId, options?.enabled !== false)
  const [value, setValue] = useState<ReasonValue>(EMPTY_REASON)
  const [touched, setTouched] = useState(false)
  const rows = list.data
  const reset = useCallback(() => { setValue(EMPTY_REASON); setTouched(false) }, [])
  const problem = reasonProblem(value, required)
  return useMemo(() => ({
    category,
    list,
    rows: rows || [],
    value,
    setValue,
    touched,
    reset,
    problem,
    complete: reasonComplete(value, required),
    /** Marks the field touched (shows the inline error) and says whether it may be sent. */
    validate: () => { setTouched(true); return problem === null },
    text: value.code ? reasonText(rows, value) : "",
    payload: (legacyKey: string | null = "reason") => (value.code ? reasonPayload(rows, value, legacyKey) : {}),
  }), [category, list, rows, value, touched, reset, problem, required])
}
