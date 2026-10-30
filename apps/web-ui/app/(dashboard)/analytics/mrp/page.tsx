import { redirect } from "next/navigation"

import { mrpRedirect, type SearchParamsInput } from "@/lib/retired-routes"

/**
 * MRP coverage is replaced by the RM inward calendar (client 2026-10-28): one demand engine, day-by-day cover
 * and the Owner's approved arrivals. Old links open the calendar's List view.
 */
export default async function AnalyticsMrpRedirect({ searchParams }: { searchParams: Promise<SearchParamsInput> }) {
  redirect(mrpRedirect(await searchParams))
}
