"use client"

import React from "react"
import { AnalyticsProvider, useAnalyticsContext } from "@/components/providers/analytics-provider"

function AnalyticsLayoutContent({ children }: { children: React.ReactNode }) {
  const { startDate, endDate, setStartDate, setEndDate } = useAnalyticsContext()

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto pb-12">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Intelligence & Analytics</h1>
          <p className="text-sm text-slate-500 mt-1">
            Read-only insights aggregated from verified production snapshots.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center bg-slate-50 border border-slate-200 rounded-lg p-1 shadow-inner">
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="text-sm bg-transparent border-none focus:ring-0 w-[130px] font-medium text-slate-700 cursor-pointer"
            />
            <span className="text-slate-400 font-medium px-2">—</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="text-sm bg-transparent border-none focus:ring-0 w-[130px] font-medium text-slate-700 cursor-pointer"
            />
          </div>
        </div>
      </div>

      {/* Analytics Views */}
      <div className="animate-in fade-in duration-500">
        {children}
      </div>
    </div>
  )
}

export default function AnalyticsLayout({ children }: { children: React.ReactNode }) {
  return (
    <AnalyticsProvider>
      <AnalyticsLayoutContent>{children}</AnalyticsLayoutContent>
    </AnalyticsProvider>
  )
}
