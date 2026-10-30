import { redirect } from "next/navigation"

import { lifecycleRedirect, type SearchParamsInput } from "@/lib/retired-routes"

/**
 * The Stock lifecycle tracker folded into Stock counts & book (client 2026-10-28): the month opens by itself,
 * month-end is the Month-end count, and closing lives on Month-end close.
 */
export default async function StockLifecycleRedirect({ searchParams }: { searchParams: Promise<SearchParamsInput> }) {
  redirect(lifecycleRedirect(await searchParams))
}
