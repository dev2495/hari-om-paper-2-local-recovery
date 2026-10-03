"use client"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { seasonApi, seasonLabel } from "@/lib/season-api"

export function SeasonChip() {
  const state = useQuery({ queryKey: ["production-season"], queryFn: async () => (await seasonApi.state()).data, staleTime: 30000, refetchInterval: 60000 })
  if (!state.data) return null
  return <Link href="/settings/production-season" className="hidden whitespace-nowrap rounded-full border border-border bg-muted px-3 py-1.5 text-xs font-semibold sm:inline-flex" title="Active production season across both plants">{seasonLabel(state.data.active_season)}</Link>
}
