"use client"

import { RoleGate } from "@/components/workspace/role-gate"

export default function PurchaseLayout({ children }: { children: React.ReactNode }) {
  return <RoleGate allow={["Store", "Planner", "PlantManager"]}>{children}</RoleGate>
}
