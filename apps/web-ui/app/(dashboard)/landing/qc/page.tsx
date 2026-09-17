"use client"

import { RoleGate } from "@/components/workspace/role-gate"
import { RoleLanding } from "@/components/workspace/role-landing"

export default function QcLandingRoute() {
  return (
    <RoleGate allow={["QC"]}>
      <RoleLanding landingRole="QC" />
    </RoleGate>
  )
}
