"use client"

import { usePathname } from "next/navigation"

import { RoleGate } from "@/components/workspace/role-gate"

export default function MastersLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || ""
  const plantManagerOk = pathname.startsWith("/masters/reason-codes")
  // Sales and planning can read the order close reasons (the close dialogs link here); only the
  // Owner or an Admin changes them (the page shows a read-only list to everyone else).
  const closeReasons = pathname.startsWith("/masters/order-close-reasons")
  return (
    <RoleGate allow={closeReasons ? ["Owner", "Admin", "Sales", "PlantManager", "Planner"] : plantManagerOk ? ["Owner", "Admin", "PlantManager"] : ["Owner", "Admin"]}>
      {children}
    </RoleGate>
  )
}
