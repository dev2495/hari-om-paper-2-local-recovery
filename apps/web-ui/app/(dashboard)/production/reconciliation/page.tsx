import { Suspense } from "react"

import { MonthEndClose } from "@/components/month-end/month-end-close"
import { LoadingState } from "@/components/workspace/query-state"
import { RoleGate } from "@/components/workspace/role-gate"

/** Month-end close (client 2026-10-28): ?tab=month|past|year &month=YYYY-MM &plant=<id>. */
export default function Page() {
  return (
    <RoleGate allow={["Owner", "Admin", "PlantManager"]}>
      <Suspense fallback={<LoadingState label="Opening month-end close…" />}>
        <MonthEndClose />
      </Suspense>
    </RoleGate>
  )
}
