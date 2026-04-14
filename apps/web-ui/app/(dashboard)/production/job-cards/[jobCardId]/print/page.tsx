"use client"

import { useParams } from "next/navigation"

import JobCardDocument from "@/components/production/JobCardDocument"

export default function JobCardPrintPage() {
  const params = useParams<{ jobCardId: string }>()
  const jobCardId = String(params?.jobCardId || "")

  return <JobCardDocument jobCardId={jobCardId} mode="print" />
}