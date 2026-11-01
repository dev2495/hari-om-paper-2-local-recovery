"use client"

// Reel / lot label sheet (client 2026-10-28): stock a count added (unknown label, loose stock, an issued reel
// found in the store) is a new lot on QC hold with a new number; it needs a label before it can be scanned at
// the issue desk or in the next count. ?ids=<id,id> prints those lots; &count=<id> links back to the count.

import { useSearchParams } from "next/navigation"
import { Suspense, useMemo } from "react"
import { Tags } from "lucide-react"

import { LabelPrintBar, LabelSheet, useLabelLayout } from "@/components/inventory/label-sheet"
import { LotLabel } from "@/components/inventory/lot-label"
import { BackLink, EmptyBlock, Notice, PickPlant } from "@/components/inventory/stock-ui"
import { PageHeader } from "@/components/workspace/page-header"
import { ErrorState, LoadingState } from "@/components/workspace/query-state"
import { useAuth } from "@/context/AuthContext"
import { useLots, useSinglePlant } from "@/hooks/use-stock"
import { usePlants } from "@/hooks/use-system"
import { errorText } from "@/lib/api-stock"

export default function LotLabelsPage() {
  return (
    <Suspense fallback={<LoadingState label="Preparing labels…" />}>
      <LotLabelSheet />
    </Suspense>
  )
}

function LotLabelSheet() {
  const search = useSearchParams()
  const { activePlant } = useAuth()
  const single = useSinglePlant()
  const ids = useMemo(() => (search.get("ids") || "").split(",").map((value) => value.trim()).filter(Boolean).slice(0, 60), [search])
  const countId = search.get("count") || ""
  const query = useLots(ids)
  const plants = usePlants()
  const plantName = (Array.isArray(plants.data) ? plants.data : []).find((row: any) => String(row.id) === String(activePlant))?.name
  const back = countId ? <BackLink href={`/inventory/counts/${countId}`}>Back to the count</BackLink> : <BackLink href="/inventory/locations">Locations</BackLink>
  const rows = query.data?.items || []
  const allowed = Boolean(query.data?.can.manage || query.data?.can.move)
  const [layout, setLayout] = useLabelLayout()

  if (!single) return <PickPlant what="the label sheet" />
  return (
    <div className="space-y-4" data-testid="lot-labels">
      <div className="no-print space-y-4">
        {back}
        <PageHeader badge="Stores" title="Lot labels" description="Reels and coils print the plant's own label with a QR. Print the A4 sheet (8 per page) and cut, or one label per page. The QR opens the lot on any phone camera."
          actions={allowed && rows.length ? <LabelPrintBar layout={layout} onLayout={setLayout} count={rows.length} testId="lot-labels-print" /> : null} />
        {allowed && rows.some((row) => row.held) ? <Notice tone="amber">Lots on QC hold stay on hold until incoming QC clears them. Reel and coil labels do not print the QC state: scan the QR to see it.</Notice> : null}
      </div>
      {!ids.length ? <EmptyBlock icon={Tags} title="No lots chosen" message="Open a count or a location and choose the lots to print." />
        : query.isLoading ? <LoadingState label="Preparing labels…" />
        : query.isError || !query.data ? <ErrorState title="Labels could not be prepared" message={errorText(query.error)} onRetry={() => void query.refetch()} />
        : !allowed ? <EmptyBlock icon={Tags} title="Labels are printed by the store" message="Store, GRN, raw-material issue, the plant head, the Owner and Admin print lot labels. Ask them for this label." testId="lot-labels-not-allowed" />
        : rows.length ? (
          <LabelSheet layout={layout} testId="lot-labels-sheet">
            {rows.map((row) => <LotLabel key={row.id} lot={row} plantId={String(activePlant)} plantName={plantName} />)}
          </LabelSheet>
        ) : <EmptyBlock icon={Tags} title="These lots are not in this plant" message="Check the plant at the top." />}
    </div>
  )
}
