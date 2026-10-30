import { Suspense } from "react"

import { UsageLimits } from "@/components/month-end/usage-limits"
import { LoadingState } from "@/components/workspace/query-state"

/** Usage limits (client 2026-10-28): Owner / Admin edit, everyone else reads. ?plant=<id>. */
export default function Page() {
  return (
    <Suspense fallback={<LoadingState label="Opening usage limits…" />}>
      <UsageLimits />
    </Suspense>
  )
}
