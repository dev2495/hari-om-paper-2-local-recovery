"use client"

import { AnalyticsProvider } from "@/components/providers/analytics-provider"
import { RoleGate } from "@/components/workspace/role-gate"

export default function ReportsLayout({ children }: { children: React.ReactNode }) {
  return (
    <RoleGate allow={["PlantManager", "Planner", "Store", "Dispatch", "Sales", "QC"]}>
      <AnalyticsProvider>{children}</AnalyticsProvider>
    </RoleGate>
  )
}
