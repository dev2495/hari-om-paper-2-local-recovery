import { redirect } from "next/navigation"

import { reconciliationRedirect, type SearchParamsInput } from "@/lib/retired-routes"

/**
 * Close history is the Past months tab of Month-end close (client 2026-10-28).
 */
export default async function ReconciliationHistoryRedirect({ searchParams }: { searchParams: Promise<SearchParamsInput> }) {
  redirect(reconciliationRedirect("history", await searchParams))
}
