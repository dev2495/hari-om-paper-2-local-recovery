"use client"

import { usePathname } from "next/navigation"

import { RoleGate } from "@/components/workspace/role-gate"

export default function SalesOrdersLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || ""
  const pending = pathname === "/sales-orders/pending" || pathname.startsWith("/sales-orders/pending/")
  return (
    <RoleGate allow={pending ? ["Sales", "Planner", "PlantManager"] : ["Sales", "Planner"]}>
      {children}
    </RoleGate>
  )
}
