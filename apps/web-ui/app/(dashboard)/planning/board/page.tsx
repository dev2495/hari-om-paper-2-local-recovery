import { Suspense } from "react"
import { PlanningWorkspace } from "@/components/planning/planning-workspace"
export default function PlanningBoardPage() {
  return <Suspense fallback={<p className="p-6 text-sm text-muted-foreground">Loading planner…</p>}><PlanningWorkspace /></Suspense>
}
