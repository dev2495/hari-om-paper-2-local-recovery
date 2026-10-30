import { redirect } from "next/navigation"

import { countsRedirect, type SearchParamsInput } from "@/lib/retired-routes"

/**
 * Counts are listed on the Stock counts & book hub; each count opens at /inventory/counts/<id> (client 2026-10-28).
 */
export default async function StockCountsListRedirect({ searchParams }: { searchParams: Promise<SearchParamsInput> }) {
  redirect(countsRedirect(await searchParams))
}
