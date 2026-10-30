import { redirect } from "next/navigation"

import { reconciliationRedirect, type SearchParamsInput } from "@/lib/retired-routes"

/**
 * Actual entry is part of Month-end close (client 2026-10-28): used quantities come from the month-end count,
 * notes are typed on each item. Old links open that month's close.
 */
export default async function ReconciliationActualsRedirect({ searchParams }: { searchParams: Promise<SearchParamsInput> }) {
  redirect(reconciliationRedirect("actuals", await searchParams))
}
