import { Suspense } from "react"

import { PlanningOverview } from "@/components/planning/overview/planning-overview"

export default function PlanningOverviewPage() {
  return (
    <Suspense fallback={<p className="p-6 text-sm text-muted-foreground">Loading planning overview…</p>}>
      <PlanningOverview />
    </Suspense>
  )
}
