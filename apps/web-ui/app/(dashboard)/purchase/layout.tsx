"use client"

import { usePathname } from "next/navigation"

import { RoleGate } from "@/components/workspace/role-gate"

// Narrow desk roles reach only their own purchase screens: GRN receives goods, Inward QC reads receipts.
const DESK_ROUTES: Array<{ prefix: string; roles: string[] }> = [
  { prefix: "/purchase/inward", roles: ["GRN"] },
  { prefix: "/purchase/receipts", roles: ["GRN", "InwardQC"] },
  { prefix: "/purchase/supplier-deliveries", roles: ["GRN"] },
]

export default function PurchaseLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || ""
  if (pathname === "/purchase/requisitions") return <>{children}</>
  const desk = DESK_ROUTES.find((route) => pathname === route.prefix || pathname.startsWith(`${route.prefix}/`))
  return <RoleGate allow={["Store", "Planner", "PlantManager", ...(desk?.roles || [])]}>{children}</RoleGate>
}
