"use client"

import { Suspense } from "react"
import { useParams } from "next/navigation"

import { JobCardPage } from "@/components/production/card/JobCardPage"
import { LoadingState } from "@/components/workspace/query-state"

export default function ProductionJobCardDetailPage() {
  const params = useParams<{ jobCardId: string }>()
  const jobCardId = String(params?.jobCardId || "")

  return (
    <Suspense fallback={<LoadingState label="Opening the job card…" />}>
      <JobCardPage jobCardId={jobCardId} />
    </Suspense>
  )
}
