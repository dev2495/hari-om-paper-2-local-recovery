"use client"

import { RoleGate } from "@/components/workspace/role-gate"

export default function SystemLayout({ children }: { children: React.ReactNode }) {
  return <RoleGate allow={["Owner", "Admin"]}>{children}</RoleGate>
}
