"use client"

import { Suspense } from "react"

import { JobCardManager } from "@/components/production/job-card-manager"
import { RoleGate } from "@/components/workspace/role-gate"

/**
 * Job card manager (client 2026-10-27): planners, the plant head, owner and admin. Everyone else
 * keeps the job cards list, the card page and the floor forms.
 */
export default function JobCardManagerPage() {
  return (
    <RoleGate
      allow={["Planner", "PlantManager"]}
      fallbackTitle="The Job card manager is for planners and the plant head"
      fallbackMessage="Splitting, editing, force closing and emergency inserts change the plan and the sales order, so they stay with planning. You can still open any job card, log output and QC from the Job cards list."
    >
      <Suspense fallback={<p className="p-6 text-sm text-muted-foreground">Loading job card manager…</p>}>
        <JobCardManager />
      </Suspense>
    </RoleGate>
  )
}
