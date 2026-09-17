"use client"

import { ReportDetailPage } from "@/components/analytics/ReportDetailPage"
import { RoleGate } from "@/components/workspace/role-gate"

export default function QualityAnalyticsPage() {
  return (
    <RoleGate allow={["QC", "PlantManager", "Planner"]}>
      <ReportDetailPage type="quality" />
    </RoleGate>
  )
}
