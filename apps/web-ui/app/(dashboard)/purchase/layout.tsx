"use client"

import { usePathname } from "next/navigation"

import { RoleGate } from "@/components/workspace/role-gate"

// Narrow desk roles reach only their own purchase screens: GRN receives goods (and reads the RM inward
// calendar to see what is coming, client 2026-10-28), Inward QC and QC read receipts.
const DESK_ROUTES: Array<{ prefix: string; roles: string[] }> = [
  { prefix: "/purchase/inward", roles: ["GRN"] },
  { prefix: "/purchase/scheduler", roles: ["GRN"] },
  // QC (the Quality role) reads receipts too, so Inspect from a GRN reaches the main QC user.
  { prefix: "/purchase/receipts", roles: ["GRN", "InwardQC", "QC"] },
  { prefix: "/purchase/supplier-deliveries", roles: ["GRN"] },
]

export default function PurchaseLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || ""
  if (pathname === "/purchase/requisitions") return <>{children}</>
  const desk = DESK_ROUTES.find((route) => pathname === route.prefix || pathname.startsWith(`${route.prefix}/`))
  return <RoleGate allow={["Store", "Planner", "PlantManager", ...(desk?.roles || [])]}>{children}</RoleGate>
}
