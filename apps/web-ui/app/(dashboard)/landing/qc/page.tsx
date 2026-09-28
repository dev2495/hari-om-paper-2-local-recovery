"use client"
import Link from "next/link"
import { usePendingInventoryQuality } from "@/hooks/use-inventory"
import { RoleGate } from "@/components/workspace/role-gate"
import { ProcurementShell, RequestErrors, WorkPanel, primaryButton, secondaryButton } from "@/components/procurement/procurement-shell"

export default function QcLandingRoute() {
  const query = usePendingInventoryQuality()
  const rows = Array.isArray(query.data) ? query.data : []
  const overdue = rows.filter((row:any) => row.overdue).length
  return <RoleGate allow={["QC"]}><ProcurementShell eyebrow="Quality control" title="QC workspace" description="Inspect incoming material, record process checks and keep held stock out of production.">
    <WorkPanel title="Incoming QC · due within 24 hours" description="Check each lot against its frozen approved tolerance revision. Failed, rejected and held stock remains unavailable for production." action={<button className={secondaryButton} disabled={query.isFetching} onClick={() => query.refetch()}>Refresh queue</button>}>
      <RequestErrors errors={[query.error]} />
      <p className="text-2xl font-semibold tabular-nums">{query.isLoading ? "Loading inspection queue…" : query.isError ? "Inspection queue unavailable" : `${rows.length} awaiting inspection · ${overdue} overdue`}</p>
      <div className="mt-4 flex flex-wrap gap-2"><Link className={primaryButton} href="/quality/incoming">Inspect inward material</Link><Link className={secondaryButton} href="/quality/results">Results and holds</Link></div>
      {!query.isError && !query.isLoading && rows.length === 0 ? <p className="mt-4 text-sm text-muted-foreground">No incoming lots await inspection in your plant.</p> : null}
      {!query.isError && rows.length > 0 ? <p className="mt-4 text-sm text-muted-foreground">The queue shows the oldest pending lots first. Open Incoming QC for material, supplier, due time and required readings.</p> : null}
    </WorkPanel>
    <div className="grid gap-6 lg:grid-cols-2"><WorkPanel title="Material standards" description="Prepare the checks and tolerance bands for each raw or packing material. Every saved revision and approval retains its history."><Link className={secondaryButton} href="/quality/material-standards">Review material standards</Link><p className="mt-3 text-sm text-muted-foreground">Owner or Admin approval is required before a new standard governs inward stock.</p></WorkPanel>
    <WorkPanel title="Production quality" description="Record winding, oven and other process readings against the job's approved specification."><div className="flex flex-wrap gap-2"><Link className={secondaryButton} href="/quality/stage">Stage QC</Link><Link className={secondaryButton} href="/production/job-cards">Job cards</Link><Link className={secondaryButton} href="/reports/quality">Quality reports</Link></div></WorkPanel></div>
  </ProcurementShell></RoleGate>
}
