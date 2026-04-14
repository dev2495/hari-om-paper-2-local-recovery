"use client"

import DashboardAnalyticsPage from "@/app/(dashboard)/analytics/dashboard/page"
import { AnalyticsProvider } from "@/components/providers/analytics-provider"

export default function AnalyticsOverviewPage() {
  return (
    <AnalyticsProvider>
      <DashboardAnalyticsPage />
    </AnalyticsProvider>
  )
}

