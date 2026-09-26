"use client"

import { useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"

/**
 * The separate pending-orders workspace was folded into the sales register, which now has
 * the same server-side filters (source, due, unreleased, hold, expiry, dates, sort). Old links
 * land on the register with the equivalent filters applied.
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
    else if (due === "PRIORITY") next.set("due", "week")
    router.replace(`/sales-orders${next.toString() ? `?${next.toString()}` : ""}`)
  }, [router, searchParams])
  return <p className="p-6 text-sm text-muted-foreground" data-testid="pending-orders:redirect">Opening the sales register…</p>
}
