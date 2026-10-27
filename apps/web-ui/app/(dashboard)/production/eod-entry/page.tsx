"use client"

// End-of-day entry moved into the job card page and the floor picker (client 2026-10-27).
// Older links keep working: ?job_card_id=… lands on that card, everything else on the picker.

import { Suspense, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"

import { LoadingState } from "@/components/workspace/query-state"

function Redirect() {
  const router = useRouter()
  const searchParams = useSearchParams()
  useEffect(() => {
    const query = new URLSearchParams(searchParams?.toString() || "")
    const jobCardId = query.get("job_card_id") || ""
    query.delete("job_card_id")
    if (!query.get("mode")) query.set("mode", "output")
    router.replace(jobCardId ? `/production/entry/${encodeURIComponent(jobCardId)}?${query.toString()}` : `/production/entry?${query.toString()}`)
  }, [router, searchParams])
  return <LoadingState label="Opening floor entry…" />
}

export default function EodEntryRedirectPage() {
  return (
    <Suspense fallback={<LoadingState label="Opening floor entry…" />}>
      <Redirect />
    </Suspense>
  )
}
