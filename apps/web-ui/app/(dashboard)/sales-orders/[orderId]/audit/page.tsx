"use client"

import { useEffect } from "react"
import { useParams, useRouter } from "next/navigation"

/**
 * The separate audit page was folded into the Order page's History tab (client 2026-10-27): one
 * timeline with the order's own events and every event of its job cards. Old links land there.
 */
export default function SalesOrderAuditRedirect() {
  const params = useParams()
  const router = useRouter()
  const orderId = String(params?.orderId || "")
  useEffect(() => {
    router.replace(orderId ? `/sales-orders/${orderId}?tab=history` : "/sales-orders")
  }, [orderId, router])
  return <p className="p-6 text-sm text-muted-foreground" data-testid="sales-order-audit:redirect">Opening the order history…</p>
}
