"use client"

import LossAnalyticsPage from "@/app/(dashboard)/analytics/loss/page"
import { AnalyticsProvider } from "@/components/providers/analytics-provider"

export default function AnalyticsLossPage() {
  return (
    <AnalyticsProvider>
      <LossAnalyticsPage />
    </AnalyticsProvider>
  )
}

