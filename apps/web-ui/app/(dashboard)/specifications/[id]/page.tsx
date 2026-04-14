"use client"

import { useParams } from "next/navigation"

import { SpecSheetDocument } from "@/components/specs/SpecSheetDocument"

export default function SpecificationDetailPage() {
  const params = useParams()
  const specId = String(params.id || "")

  return <SpecSheetDocument mode="view" specId={specId} />
}
