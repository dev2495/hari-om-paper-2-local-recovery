import { redirect } from "next/navigation"

import { reconciliationRedirect, type SearchParamsInput } from "@/lib/retired-routes"

/**
 * Weekly drift is the running month's "so far" view on Month-end close (client 2026-10-28).
 */
export default async function ReconciliationDriftRedirect({ searchParams }: { searchParams: Promise<SearchParamsInput> }) {
  redirect(reconciliationRedirect("drift", await searchParams))
}
