"use client"

import { IntelligenceReportCatalog } from "@/components/reports/catalog"
import { ReportHero } from "@/components/reports/primitives"
import { CommandCenter } from "@/components/workspace/command-center"
import { RoleGate } from "@/components/workspace/role-gate"

export default function AnalyticsLandingWrapper() {
  return (
    <RoleGate allow={["PlantManager", "Planner", "Store", "Dispatch", "Sales", "QC"]}>
      <AnalyticsLandingPage />
    </RoleGate>
  )
}

function AnalyticsLandingPage() {
  return (
    <div className="space-y-5 pb-10" data-testid="analytics-landing-page">
      <CommandCenter
        role="Owner"
        variant="analytics"
        testId="analytics-snapshot"
        header={
          <ReportHero
            eyebrow="Intelligence"
            title="How the business is running"
            description="Live KPIs for the selected period from the analytics owner pack, sales and job-card aggregates. Every figure opens its source report below."
            accent="violet"
          />
        }
      />
      <IntelligenceReportCatalog />
    </div>
  )
}
