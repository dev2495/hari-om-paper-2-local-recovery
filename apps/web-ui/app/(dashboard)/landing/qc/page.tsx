"use client"
import Link from "next/link"
import { usePendingInventoryQuality } from "@/hooks/use-inventory"
import { RoleGate } from "@/components/workspace/role-gate"
import { RoleLanding } from "@/components/workspace/role-landing"
import { RequestErrors, WorkPanel, primaryButton, secondaryButton } from "@/components/procurement/procurement-shell"
export default function QcLandingRoute() {
  const query = usePendingInventoryQuality()
  const rows = Array.isArray(query.data) ? query.data : []
  const overdue = rows.filter((row:any)=>row.overdue).length
  return <RoleGate allow={["QC"]} omitOwnerAdmin><div className="space-y-6"><WorkPanel title="Incoming QC · due within 24 hours" description="Check material against its frozen approved tolerance revision. Failed, rejected and held stock remains unavailable for production.">
    <RequestErrors errors={[query.error]} /><p className="text-2xl font-semibold tabular-nums">{query.isLoading ? "Loading…" : `${rows.length} awaiting inspection · ${overdue} overdue`}</p>
    <div className="mt-4 flex flex-wrap gap-2"><Link className={primaryButton} href="/quality/incoming">Inspect inward material</Link><Link className={secondaryButton} href="/quality/material-standards">Material standards</Link><Link className={secondaryButton} href="/quality/results">Results and holds</Link></div>
  </WorkPanel><RoleLanding landingRole="QC" /></div></RoleGate>
}
