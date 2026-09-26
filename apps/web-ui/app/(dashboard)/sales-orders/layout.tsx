"use client"

import { usePathname } from "next/navigation"

import { RoleGate } from "@/components/workspace/role-gate"

export default function SalesOrdersLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || ""
  void pathname
  return (
    <RoleGate allow={["Sales", "Planner", "PlantManager"]}>
      {children}
    </RoleGate>
  )
}
