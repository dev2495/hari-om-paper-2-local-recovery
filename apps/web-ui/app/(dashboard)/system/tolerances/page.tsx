import { redirect } from "next/navigation"

import { tolerancesRedirect, type SearchParamsInput } from "@/lib/retired-routes"

/**
 * Stock variance limits are now Usage limits under Month-end close (client 2026-10-28): normal wastage %,
 * allowed gap % and minimum gap per material type.
 */
export default async function SystemTolerancesRedirect({ searchParams }: { searchParams: Promise<SearchParamsInput> }) {
  redirect(tolerancesRedirect(await searchParams))
}
