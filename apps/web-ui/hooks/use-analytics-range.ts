"use client"

import { useEffect, useMemo, useState } from "react"

import { useAnalyticsContext } from "@/components/providers/analytics-provider"

export function useAnalyticsRange(defaultDays = 30) {
  const [days, setDays] = useState(defaultDays)
  const range = useMemo(() => {
    const end = new Date()
    const start = new Date(end)
    start.setDate(end.getDate() - days)
    return {
      days,
      setDays,
      startDate: start.toISOString().slice(0, 10),
      endDate: end.toISOString().slice(0, 10),
    }
  }, [days])
  return range
}

export function useSyncAnalyticsRange(
  range?: {
    start_date?: string | null
    end_date?: string | null
  } | null,
) {
  const { setAvailableRange } = useAnalyticsContext()

  useEffect(() => {
    if (!range || (!range.start_date && !range.end_date)) return
    setAvailableRange({
      start_date: range.start_date ?? null,
      end_date: range.end_date ?? null,
    })
  }, [range?.start_date, range?.end_date, setAvailableRange])
}
