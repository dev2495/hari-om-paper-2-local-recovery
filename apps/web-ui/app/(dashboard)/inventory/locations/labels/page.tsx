"use client"

// Rack label sheet (client 2026-10-28): A4, two labels per row. Each label has the code big enough to read
// from the aisle, the plain name and a QR that the phone camera opens as /scan?c=HARIOM|LOC|… — the
// location page with actions by role. ?ids=<id,id> prints those racks; without it, every active location.

import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Suspense, useMemo } from "react"
import { Printer, Tags } from "lucide-react"

import { LocationLabel } from "@/components/inventory/location-label"
import { BackLink, EmptyBlock, Notice, PickPlant } from "@/components/inventory/stock-ui"
import { PageHeader } from "@/components/workspace/page-header"
import { ErrorState, LoadingState } from "@/components/workspace/query-state"
import { useAuth } from "@/context/AuthContext"
import { useLocationsOverview, useSinglePlant } from "@/hooks/use-stock"
import { usePlants } from "@/hooks/use-system"
import { errorText } from "@/lib/api-stock"

export default function LocationLabelsPage() {
  return (
    <Suspense fallback={<LoadingState label="Preparing labels…" />}>
      <LabelSheet />
    </Suspense>
  )
}

function LabelSheet() {
  const search = useSearchParams()
  const { activePlant } = useAuth()
  const single = useSinglePlant()
  const query = useLocationsOverview()
  const plants = usePlants()
  const ids = (search.get("ids") || "").split(",").map((value) => value.trim()).filter(Boolean)
  const rows = useMemo(() => (query.data?.items || []).filter((row) => (ids.length ? ids.includes(row.id) : row.active && row.purpose !== "WIP")), [query.data, ids])
  const plantName = (Array.isArray(plants.data) ? plants.data : []).find((row: any) => String(row.id) === String(activePlant))?.name

  if (!single) return <PickPlant what="the label sheet" />
  const allowed = !query.data || query.data.can.manage
  return (
    <div className="space-y-4" data-testid="location-labels">
      <div className="no-print space-y-4">
        <BackLink href="/inventory/locations">Locations</BackLink>
        <PageHeader badge="Stores" title="Rack labels" description="Print on A4 and stick one on each rack at eye level. The QR opens the rack's page on any phone camera."
          actions={allowed && rows.length ? <button type="button" className="erp-btn-primary !h-11" onClick={() => window.print()} disabled={!rows.length} data-testid="labels-print"><Printer className="h-4 w-4" aria-hidden="true" />Print {rows.length} label{rows.length === 1 ? "" : "s"}</button> : null} />
        {allowed && rows.length ? <Notice tone="blue">Laminate labels in the store so they last; a label that will not scan can be reprinted any time from here.</Notice> : null}
      </div>
      {!allowed ? <EmptyBlock icon={Tags} title="Labels are printed by the store" message="Store, the plant head, the Owner and Admin print rack labels. Ask them for a new label." testId="labels-not-allowed" /> : query.isLoading ? <LoadingState label="Preparing labels…" /> : query.isError ? <ErrorState title="Labels could not be prepared" message={errorText(query.error)} onRetry={() => void query.refetch()} /> : rows.length ? (
        <div className="label-print-grid grid gap-4 md:grid-cols-2">
          {rows.map((row) => <LocationLabel key={row.id} location={row} plantId={String(activePlant)} plantName={plantName} />)}
        </div>
      ) : <EmptyBlock icon={Tags} title={ids.length ? "These locations are not in this plant" : "No locations to print"} message={ids.length ? "The link may be old, or the racks belong to another plant: check the plant at the top, or choose racks on the Locations page." : "Choose racks on the Locations page, or add locations first."} action={<Link href="/inventory/locations" className="erp-btn-primary !h-11">Open Locations</Link>} testId="labels-none" />}
    </div>
  )
}
