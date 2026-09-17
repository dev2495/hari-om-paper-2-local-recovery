"use client"

import { RoleGate } from "@/components/workspace/role-gate"
import { OwnerLandingPage } from "@/components/workspace/owner-admin-landings"

export default function OwnerLandingRoute() {
  return (
    <RoleGate allow={["Owner"]}>
      <OwnerLandingPage />
    </RoleGate>
  )
}
