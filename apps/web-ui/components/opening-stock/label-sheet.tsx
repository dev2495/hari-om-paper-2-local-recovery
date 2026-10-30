"use client"

import { useState } from "react"
import { CheckCircle2, Printer, Tags } from "lucide-react"

import { LotLabel } from "@/components/inventory/lot-label"
import { BackLink, EmptyBlock, Notice, PickPlant } from "@/components/inventory/stock-ui"
import { PageHeader } from "@/components/workspace/page-header"
import { ErrorState, LoadingState } from "@/components/workspace/query-state"
import { useAuth } from "@/context/AuthContext"
import { usePlants } from "@/hooks/use-system"
import { dayText, errorText, plural, qtyText } from "@/lib/api-stock"

import { useOpeningLabels, type OpeningLabel } from "./api"

/** Used up since posting: issued in full, so its reel or bag is gone and no label is needed. */
function usedUp(label: OpeningLabel): boolean {
  return Number(label.qty || 0) <= 0
}

/** The label prints what was posted on that reel or bag (the posted weight), never what is left today. */
function printed(label: OpeningLabel): OpeningLabel {
  return { ...label, qty: Number(label.posted_qty ?? label.qty) }
}

function labelNote(label: OpeningLabel): string {
  return [
    label.old_mark ? `Old mark ${label.old_mark}` : "",
    label.held && label.hold_reason ? `On hold: ${label.hold_reason}` : "",
    label.source_label,
  ].filter(Boolean).join(" · ")
}

/** The labels of one opening stock batch, with the same QR payload as a GRN label (HARIOM|REEL|… / BATCH). */
export function OpeningLabelSheet({ batchId }: { batchId: string }) {
  const { activePlant } = useAuth()
  const single = Boolean(activePlant && activePlant !== "ALL")
  const query = useOpeningLabels(batchId)
  const plants = usePlants()
  const plantName = (Array.isArray(plants.data) ? plants.data : []).find((row: any) => String(row.id) === String(activePlant))?.name
  const all = query.data?.labels || []
  const gone = all.filter(usedUp)
  const [withUsed, setWithUsed] = useState(false)
  const labels = withUsed ? all : all.filter((label) => !usedUp(label))

  if (!single) return <PickPlant what="the label sheet" />
  return (
    <div className="space-y-4" data-testid="opening-labels">
      <div className="no-print space-y-4">
        <BackLink href="/inventory/opening-stock">Opening stock</BackLink>
        <PageHeader badge="Stores · go-live" title={query.data ? `Labels · batch ${query.data.batch_no ?? ""}`.trim() : "Opening stock labels"}
          description="Print on A4, cut and stick each label on its reel, coil or bag. The QR opens the lot on any phone camera."
          actions={<button type="button" className="erp-btn-primary !h-11" onClick={() => window.print()} disabled={!labels.length} data-testid="opening-labels-print"><Printer className="h-4 w-4" aria-hidden="true" />Print all {plural(labels.length, "label")}</button>} />
        {gone.length ? (
          <Notice tone="slate" icon={CheckCircle2} testId="opening-labels-used"
            action={<button type="button" className="erp-btn-secondary !h-11" onClick={() => setWithUsed((value) => !value)} data-testid="opening-labels-used-toggle">{withUsed ? "Leave them out" : "Print them too"}</button>}
            title={`${plural(gone.length, "reel / lot", "reels / lots")} issued since posting: no label needed`}>
            {gone.slice(0, 6).map((label) => `${label.code} (${qtyText(label.posted_qty, label.uom)})`).join(", ")}{gone.length > 6 ? ` and ${gone.length - 6} more` : ""}.
            {withUsed ? " They are in the print run below, with the weight they were posted at." : " They are left out of “Print all”."}
          </Notice>
        ) : null}
        {query.data ? (
          <Notice tone={query.data.held_count ? "amber" : "blue"}>
            {query.data.document_no} · dated {dayText(query.data.effective_date)} · {plural(query.data.reel_count, "reel / coil", "reels / coils")}, {plural(query.data.lot_count, "bulk lot")}.
            {query.data.held_count ? ` ${query.data.held_count} on hold: the label says so, and incoming QC clears them before use.` : " All cleared for the floor."}
          </Notice>
        ) : null}
      </div>
      {!batchId ? <EmptyBlock icon={Tags} title="No batch chosen" message="Open Opening stock and choose Labels on a batch." />
        : query.isLoading ? <LoadingState label="Preparing labels…" />
        : query.isError || !query.data ? <ErrorState title="Labels could not be prepared" message={errorText(query.error)} onRetry={() => void query.refetch()} />
        : labels.length ? (
          <div className="label-print-grid grid gap-4 md:grid-cols-2">
            {labels.map((label) => (
              <LotLabel key={label.id} lot={printed(label)} plantId={String(activePlant)} plantName={plantName} note={labelNote(label)} />
            ))}
          </div>
        ) : all.length ? <EmptyBlock icon={CheckCircle2} title="Every reel and lot of this batch is issued" message="No label is needed. Choose “Print them too” to print them anyway." />
        : <EmptyBlock icon={Tags} title="This batch has no labels" message="Its lines carry no reel or lot." />}
    </div>
  )
}
