"use client"

import { useParams } from "next/navigation"

import { SpecSheetDocument } from "@/components/specs/SpecSheetDocument"

export default function EditSpecificationPage() {
  const params = useParams()
  const specId = String(params.id || "")

  return <SpecSheetDocument mode="edit" specId={specId} />
}
