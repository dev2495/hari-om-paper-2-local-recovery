"use client"

import { RoleGate } from "@/components/workspace/role-gate"

export default function JobCardsLayout({ children }: { children: React.ReactNode }) {
  return <RoleGate allow={["Planner", "PlantManager", "QC", "InProcessQC", "Operator"]}>{children}</RoleGate>
}
