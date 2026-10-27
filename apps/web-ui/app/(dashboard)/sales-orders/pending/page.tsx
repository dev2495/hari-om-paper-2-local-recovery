"use client"

import { useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"

/**
 * The separate pending-orders workspace is another list of the same orders, so it lands on the
 * Orders list: status tabs, KPI tiles (open, not released, due in 3 days, overdue…) and the same
 * server-side filters. Old links keep their meaning.
 */
export default function PendingOrdersRedirect() {
  const router = useRouter()
  const searchParams = useSearchParams()
  useEffect(() => {
    const next = new URLSearchParams()
    const search = searchParams?.get("search")
    const source = searchParams?.get("source")
    const due = String(searchParams?.get("due_risk") || "").toUpperCase()
    if (search) next.set("search", search)
    if (source) next.set("origin", source.toUpperCase())
    if (due === "OVERDUE") next.set("due", "overdue")
    else if (due === "PRIORITY") next.set("due", "priority")
    else next.set("status", "open")
    router.replace(`/sales-orders${next.toString() ? `?${next.toString()}` : ""}`)
  }, [router, searchParams])
  return <p className="p-6 text-sm text-muted-foreground" data-testid="pending-orders:redirect">Opening the Orders list…</p>
}
