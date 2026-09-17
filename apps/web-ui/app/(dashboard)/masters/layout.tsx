"use client"

import { usePathname } from "next/navigation"

import { RoleGate } from "@/components/workspace/role-gate"

export default function MastersLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || ""
  const plantManagerOk = pathname.startsWith("/masters/reason-codes")
  return (
    <RoleGate allow={plantManagerOk ? ["Owner", "Admin", "PlantManager"] : ["Owner", "Admin"]}>
      {children}
    </RoleGate>
  )
}
