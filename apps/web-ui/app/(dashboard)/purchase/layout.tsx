"use client"

import { usePathname } from "next/navigation"

import { RoleGate } from "@/components/workspace/role-gate"

export default function PurchaseLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  if (pathname === "/purchase/requisitions") return <>{children}</>
  return <RoleGate allow={["Store", "Planner", "PlantManager"]}>{children}</RoleGate>
}
