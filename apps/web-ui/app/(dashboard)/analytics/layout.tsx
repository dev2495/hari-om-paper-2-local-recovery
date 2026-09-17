"use client"

import React from "react"

import { Label } from "@/components/ui/label"
import { AnalyticsProvider, useAnalyticsContext } from "@/components/providers/analytics-provider"

function AnalyticsLayoutContent({ children }: { children: React.ReactNode }) {
  const { startDate, endDate, setStartDate, setEndDate } = useAnalyticsContext()

  return (
    <div className="mx-auto max-w-[1600px] space-y-6 pb-12">
      <div className="erp-panel flex flex-col gap-3 rounded-[1.4rem] px-4 py-3 sm:flex-row sm:items-end sm:justify-between">
        <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-cyan-800/70">Reporting window</p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="analytics-start-date">From</Label>
            <input
              id="analytics-start-date"
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="analytics-end-date">To</Label>
            <input
              id="analytics-end-date"
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        </div>
      </div>
      <div>{children}</div>
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
