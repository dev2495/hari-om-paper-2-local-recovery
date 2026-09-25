import { Suspense } from "react"
import { PlanningWorkspace } from "@/components/planning/planning-workspace"
export default function StagePlanningPage() {
  return <Suspense fallback={<p className="p-6 text-sm text-muted-foreground">Loading planner…</p>}><PlanningWorkspace sectionOverride="winder" /></Suspense>
}
