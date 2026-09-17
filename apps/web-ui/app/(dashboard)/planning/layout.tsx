"use client"

import { usePathname } from "next/navigation"

import { RoleGate } from "@/components/workspace/role-gate"

export default function PlanningLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || ""
  const tracker = pathname.startsWith("/planning/tracker")
  return (
    <RoleGate allow={tracker ? ["Planner", "PlantManager", "Dispatch", "Operator"] : ["Planner", "PlantManager"]}>
      {children}
    </RoleGate>
  )
}
