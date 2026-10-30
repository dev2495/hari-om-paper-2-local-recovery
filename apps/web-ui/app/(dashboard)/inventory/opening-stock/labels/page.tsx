"use client"

// Opening stock labels (client 2026-10-30): every reel / lot of one batch, A4, two per row, each with its QR
// /scan link, item, weight or quantity, location and old mark. ?batch=<id>; printed again any time from the batch.
import { Suspense } from "react"
import { useSearchParams } from "next/navigation"

import { OpeningLabelSheet } from "@/components/opening-stock/label-sheet"
import { LoadingState } from "@/components/workspace/query-state"

export default function Page() {
  return (
    <Suspense fallback={<LoadingState label="Preparing labels…" />}>
      <Labels />
    </Suspense>
  )
}

function Labels() {
  const search = useSearchParams()
  return <OpeningLabelSheet batchId={search.get("batch") || ""} />
}
