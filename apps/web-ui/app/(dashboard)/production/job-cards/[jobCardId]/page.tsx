"use client"

import JobCardDocument from "@/components/production/JobCardDocument"
import { useParams } from "next/navigation"

export default function ProductionJobCardDetailPage() {
  const params = useParams<{ jobCardId: string }>()
  const jobCardId = String(params?.jobCardId || "")

  return <JobCardDocument jobCardId={jobCardId} mode="view" />
}
