"use client"

import { RoleGate } from "@/components/workspace/role-gate"
import { AdminLandingPage } from "@/components/workspace/owner-admin-landings"

export default function AdminLandingRoute() {
  return (
    <RoleGate allow={["Admin"]}>
      <AdminLandingPage />
    </RoleGate>
  )
}
