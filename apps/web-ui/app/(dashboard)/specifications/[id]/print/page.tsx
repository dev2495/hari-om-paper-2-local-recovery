"use client"

import { useParams } from "next/navigation"

import { SpecSheetDocument } from "@/components/specs/SpecSheetDocument"

export default function PrintSpecificationPage() {
  const params = useParams()
  const specId = String(params.id || "")

  return <SpecSheetDocument mode="print" specId={specId} />
}
