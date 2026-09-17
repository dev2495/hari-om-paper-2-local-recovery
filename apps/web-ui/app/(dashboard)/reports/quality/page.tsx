"use client"

import { RoleGate } from "@/components/workspace/role-gate"
import VariancePage from "../variance/page"

export default function QualityReportsPage() {
  return (
    <RoleGate allow={["QC", "PlantManager", "Planner"]}>
      <VariancePage />
    </RoleGate>
  )
}
