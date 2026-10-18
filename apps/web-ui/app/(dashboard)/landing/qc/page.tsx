"use client"

import QualityDeskPage from "@/app/(dashboard)/quality/page"
import { RoleGate } from "@/components/workspace/role-gate"

// The QC role lands on the QC desk itself (client rule 2026-10-18).
export default function QcLandingRoute() {
  return <RoleGate allow={["QC"]}><QualityDeskPage /></RoleGate>
}
