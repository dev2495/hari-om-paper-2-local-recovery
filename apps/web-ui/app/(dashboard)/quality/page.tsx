"use client"

import Link from "next/link"
import { CheckCircle2, ClipboardCheck, FlaskConical, LockKeyhole, ShieldCheck } from "lucide-react"
import { useMemo } from "react"

import { EmptyState, ExecutiveHero, MetricCard, MetricRail, Panel } from "@/components/erp/shell"
import { QualityDeskNav } from "@/components/qc/QualityDeskNav"
import { RoleGate } from "@/components/workspace/role-gate"
import { ErrorState, LoadingState } from "@/components/workspace/query-state"
import { useAuth } from "@/context/AuthContext"
import { usePendingInventoryQuality } from "@/hooks/use-inventory"
import { useQualityHolds, useQualityInspections, useQualitySummary } from "@/hooks/use-production"
import { MODULE_APPEARANCES } from "@/lib/erp-appearance"

function asArray(value: any) {
  return Array.isArray(value) ? value : []
}

export default function QualityDeskHubPage() {
  useAuth()
  const inspectionsQuery = useQualityInspections({ limit: 120 })
  const qualitySummaryQuery = useQualitySummary()
  const holdsQuery = useQualityHolds({ limit: 120 })
  const pendingQualityQuery = usePendingInventoryQuality()
  const inspections = useMemo(() => asArray(inspectionsQuery.data), [inspectionsQuery.data])
  const holds = useMemo(() => asArray(holdsQuery.data), [holdsQuery.data])
  const pendingQuality = useMemo(() => asArray(pendingQualityQuery.data), [pendingQualityQuery.data])
  const activeHolds = holds.filter((hold: any) => String(hold.status || "").toUpperCase() === "HOLD")
  const failedInspections = inspections.filter((row: any) => String(row.status || "").toUpperCase() === "FAIL")
  const { data: qualitySummary } = qualitySummaryQuery
  const inspectionCount = Number(qualitySummary?.inspection_count ?? inspections.length)
  const passRate = qualitySummary?.pass_rate
  const passRateDisplay = inspectionCount <= 0 || passRate == null ? "No data" : `${Number(passRate).toFixed(1)}%`

  return (
    <RoleGate allow={["QC", "PlantManager", "Store", "Dispatch", "Sales"]}>
      <div className="space-y-6" data-testid="quality:page">
        <ExecutiveHero
          appearance={MODULE_APPEARANCES.analytics}
          badge="Quality Desk"
          title="Quality control"
          description="Incoming material uses the item quality profile. Winding, oven, and process use frozen spec ranges. Holds and dispositions stay on the results desk. The server computes every verdict."
          aside={
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full bg-card/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                <ShieldCheck className="h-3.5 w-3.5" />
                Server-side evaluator
              </div>
              <p className="text-2xl font-semibold tracking-tight">{activeHolds.length} active hold(s)</p>
              <p className="text-sm text-muted-foreground">Pass rate {passRateDisplay} across the current quality window.</p>
            </div>
          }
        />
        <QualityDeskNav />
        {inspectionsQuery.isLoading ? <LoadingState label="Loading quality desk…" /> : null}
        {inspectionsQuery.isError ? (
          <ErrorState
            message="Quality inspections could not be loaded. Pass rate must not be treated as 100% or zero."
            onRetry={() => {
              void inspectionsQuery.refetch()
            }}
          />
        ) : null}
        {!inspectionsQuery.isLoading && !inspectionsQuery.isError && inspectionCount <= 0 ? (
          <EmptyState label="No inspections in this plant scope yet." />
        ) : null}
        <MetricRail>
          <MetricCard label="Active Holds" value={activeHolds.length} detail="Dispatch-blocking quality decisions" icon={LockKeyhole} tone={activeHolds.length ? "rose" : "emerald"} />
          <MetricCard label="Pass Rate" value={passRateDisplay} detail={inspectionCount ? "Latest inspection window" : "No inspections in plant scope"} icon={CheckCircle2} tone="cyan" />
          <MetricCard label="Failures" value={failedInspections.length} detail="Measured FAIL results" icon={ClipboardCheck} tone={failedInspections.length ? "amber" : "slate"} />
          <MetricCard label="Inward QC" value={pendingQuality.length} detail="Held material awaiting inspection" icon={FlaskConical} tone={pendingQuality.length ? "amber" : "emerald"} />
        </MetricRail>
        <div className="grid gap-4 md:grid-cols-3">
          {[
            ["/quality/incoming", "Incoming QC", "Inspect receipt lots against the owned item quality profile. Client PASS/FAIL is ignored."],
            ["/quality/stage", "Stage QC", "Winding, oven, and process use exact client fields and frozen Allowed ranges."],
            ["/quality/results", "Results / holds", "Inspections, holds, and dispositions live here — separate from measurement entry."],
          ].map(([href, title, detail]) => (
            <Link key={href} href={href} className="rounded-[1.6rem] border border-border bg-card p-5 shadow-sm transition hover:border-signal-cyan-line">
              <p className="text-sm font-semibold text-foreground">{title}</p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{detail}</p>
            </Link>
          ))}
        </div>
        <Panel title="Binding QC rules" subtitle="These desks do not invent thresholds or copy finished-product limits into winding.">
          <ul className="grid gap-2 text-sm text-muted-foreground md:grid-cols-2">
            <li>Winding measures I.D., O.D., Height, Weight, C.S.</li>
            <li>Oven uses paired pre/post weight and moisture on one sample.</li>
            <li>Process measures Height, Weight, C.S., notch (if applicable), moisture.</li>
            <li>A FAIL needs a linked reason. A reason never creates PASS.</li>
          </ul>
        </Panel>
      </div>
    </RoleGate>
  )
}
