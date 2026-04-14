"use client"

import React, { createContext, useContext, useEffect, useMemo, useState } from "react"
import dayjs from "dayjs"

import { useAuth } from "@/context/AuthContext"

export type AnalyticsPreset = "today" | "week" | "month" | "all" | "custom"
export type AnalyticsGranularity = "day" | "week" | "month"

export type AnalyticsAvailableRange = {
  start_date?: string | null
  end_date?: string | null
} | null

interface AnalyticsContextType {
  startDate: string
  endDate: string
  setStartDate: (date: string) => void
  setEndDate: (date: string) => void
  plantId: string | undefined
  plantScope: string
  setPlantScope: (value: string) => void
  granularity: AnalyticsGranularity
  setGranularity: (value: AnalyticsGranularity) => void
  isCrossPlantDefault: boolean
  preset: AnalyticsPreset
  setPreset: (value: AnalyticsPreset) => void
  availableRange: AnalyticsAvailableRange
  setAvailableRange: (range: AnalyticsAvailableRange) => void
}

const AnalyticsContext = createContext<AnalyticsContextType | undefined>(undefined)

function resolveRange(preset: AnalyticsPreset) {
  const end = dayjs().format("YYYY-MM-DD")
  if (preset === "today") {
    return { startDate: end, endDate: end }
  }
  if (preset === "week") {
    return {
      startDate: dayjs().startOf("week").format("YYYY-MM-DD"),
      endDate: dayjs().endOf("week").format("YYYY-MM-DD"),
    }
  }
  if (preset === "month") {
    return {
      startDate: dayjs().startOf("month").format("YYYY-MM-DD"),
      endDate: dayjs().endOf("month").format("YYYY-MM-DD"),
    }
  }
  if (preset === "all") {
    return {
      startDate: "2020-01-01",
      endDate: end,
    }
  }
  return {
    startDate: dayjs().startOf("month").format("YYYY-MM-DD"),
    endDate: dayjs().endOf("month").format("YYYY-MM-DD"),
  }
}

export function useAnalyticsContext() {
  const context = useContext(AnalyticsContext)
  if (!context) {
    throw new Error("useAnalyticsContext must be used within an AnalyticsProvider")
  }
  return context
}

export function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  const { user, activePlant } = useAuth()
  const role = user?.role || user?.roles?.[0] || ""
  const isCrossPlantDefault = role === "Owner" || role === "Admin"

  const initialRange = useMemo(() => resolveRange("month"), [])
  const [startDate, setStartDateState] = useState(initialRange.startDate)
  const [endDate, setEndDateState] = useState(initialRange.endDate)
  const [plantScope, setPlantScope] = useState<string>("")
  const [granularity, setGranularity] = useState<AnalyticsGranularity>("day")
  const [preset, setPresetState] = useState<AnalyticsPreset>("month")
  const [availableRange, setAvailableRange] = useState<AnalyticsAvailableRange>(null)

  useEffect(() => {
    setPlantScope((previous) => {
      if (previous) return previous
      if (isCrossPlantDefault) return "ALL"
      return activePlant || user?.plant_id || "ALL"
    })
  }, [activePlant, isCrossPlantDefault, user?.plant_id])

  useEffect(() => {
    if (preset === "custom") return
    const range = resolveRange(preset)
    setStartDateState(range.startDate)
    setEndDateState(range.endDate)
  }, [preset])

  const setStartDate = (value: string) => {
    setPresetState("custom")
    setStartDateState(value)
  }

  const setEndDate = (value: string) => {
    setPresetState("custom")
    setEndDateState(value)
  }

  const setPreset = (value: AnalyticsPreset) => {
    setPresetState(value)
  }

  const plantId = plantScope === "ALL" ? undefined : plantScope || activePlant || user?.plant_id || undefined

  return (
    <AnalyticsContext.Provider
      value={{
        startDate,
        endDate,
        setStartDate,
        setEndDate,
        plantId,
        plantScope: plantScope || "ALL",
        setPlantScope,
        granularity,
        setGranularity,
        isCrossPlantDefault,
        preset,
        setPreset,
        availableRange,
        setAvailableRange,
      }}
    >
      {children}
    </AnalyticsContext.Provider>
  )
}
