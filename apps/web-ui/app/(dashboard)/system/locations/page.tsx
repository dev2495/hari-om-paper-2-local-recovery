import { redirect } from "next/navigation"

import { locationsRedirect, type SearchParamsInput } from "@/lib/retired-routes"

/**
 * Locations moved to Stores (client 2026-10-28) so the store team can manage racks and print labels.
 * Redirected on the server, before the System role gate, so every role's old link still works.
 */
export default async function SystemLocationsRedirect({ searchParams }: { searchParams: Promise<SearchParamsInput> }) {
  redirect(locationsRedirect(await searchParams))
}
