"use client"

import { ReportHero } from "@/components/reports/primitives"
import { CommandCenter } from "@/components/workspace/command-center"

export default function DashboardOverviewPage() {
  return (
    <div className="space-y-5 pb-10" data-testid="analytics-dashboard-page">
      <CommandCenter
        role="Owner"
        variant="analytics"
        testId="analytics-dashboard-snapshot"
        header={<ReportHero eyebrow="Analytics" title="Operating dashboard" description="Commercial, production, quality and stock KPIs for the selected period, from live server aggregates." accent="slate" />}
      />
    </div>
  )
}
