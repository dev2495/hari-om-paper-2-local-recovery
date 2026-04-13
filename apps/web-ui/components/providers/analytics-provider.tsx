"use client"

import React, { createContext, useContext, useState } from "react"
import dayjs from "dayjs"
import { useAuth } from "@/context/AuthContext"

interface AnalyticsContextType {
    startDate: string
    endDate: string
    setStartDate: (date: string) => void
    setEndDate: (date: string) => void
    plantId: string | undefined
}

const AnalyticsContext = createContext<AnalyticsContextType | undefined>(undefined)

export function useAnalyticsContext() {
    const context = useContext(AnalyticsContext)
    if (!context) {
        throw new Error("useAnalyticsContext must be used within an AnalyticsProvider")
    }
    return context
}

export function AnalyticsProvider({ children }: { children: React.ReactNode }) {
    const [startDate, setStartDate] = useState(dayjs().startOf('month').format('YYYY-MM-DD'))
    const [endDate, setEndDate] = useState(dayjs().endOf('month').format('YYYY-MM-DD'))
    const { activePlant } = useAuth()

    const plantId = activePlant || undefined

    return (
        <AnalyticsContext.Provider value={{ startDate, endDate, setStartDate, setEndDate, plantId }}>
            {children}
        </AnalyticsContext.Provider>
    )
}
