"use client"

import { RoleGate } from "@/components/workspace/role-gate"

// Same roles the dispatch service lets in: the dispatch desk prepares challans, Sales and Store look at them.
export default function DispatchLayout({ children }: { children: React.ReactNode }) {
  return (
    <RoleGate allow={["Dispatch", "Sales", "Store", "PlantManager", "Supervisor", "Logistics"]}>
      {children}
    </RoleGate>
  )
}
