"use client"

import { useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"

/**
 * The Order tracker was absorbed by the Orders list (client 2026-10-27): status tabs, one KPI strip,
 * a fulfilment bar and the job cards' stage mix per order. Missed slots live on the Planning overview.
 * Old links land on the Orders list with the equivalent filter.
 */
export default function PlanningTrackerRedirect() {
  const router = useRouter()
  const searchParams = useSearchParams()
  useEffect(() => {
    const next = new URLSearchParams()
    const search = searchParams?.get("search")
    const flow = String(searchParams?.get("status") || "")
    if (search) next.set("search", search)
    if (flow === "Commercial open") next.set("unreleased", "1")
    else if (flow === "In production") next.set("status", "production")
    else if (flow === "Dispatch ready") next.set("ready", "1")
    else if (flow === "Completed") next.set("status", "closed")
    else next.set("status", "open")
    router.replace(`/sales-orders?${next.toString()}`)
  }, [router, searchParams])
  return <p className="p-6 text-sm text-muted-foreground" data-testid="planning-tracker:redirect">The order tracker is now the Orders list. Opening it…</p>
}
