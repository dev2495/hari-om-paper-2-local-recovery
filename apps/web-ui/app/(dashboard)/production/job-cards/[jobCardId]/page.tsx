"use client"

import JobCardDocument from "@/components/production/JobCardDocument"

export default function ProductionJobCardDetailPage({ params }: { params: { jobCardId: string } }) {
  return <JobCardDocument jobCardId={params.jobCardId} mode="view" />
}