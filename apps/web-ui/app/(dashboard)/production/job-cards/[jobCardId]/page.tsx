"use client"

import JobCardDocument from "@/components/production/JobCardDocument"
import { LifecycleStrip } from "@/components/production/lifecycle-strip"
import { useParams } from "next/navigation"

export default function ProductionJobCardDetailPage() {
  const params = useParams<{ jobCardId: string }>()
  const jobCardId = String(params?.jobCardId || "")

  return (
    <>
      <LifecycleStrip jobCardId={jobCardId} />
      <JobCardDocument jobCardId={jobCardId} mode="view" />
    </>
  )
}
