"use client"

/**
 * The old reconciliation workspace (Monthly close, Actual entry, Weekly drift, Close history) became one
 * Month-end close page (client 2026-10-28). Kept as a thin alias so an old import still renders the
 * new page; the retired sub-pages redirect to its tabs.
 */
export { MonthEndClose as ReconciliationWorkspace } from "@/components/month-end/month-end-close"
