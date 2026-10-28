"use client"

// A job card read in the wrong plant answers 404. A scanned or printed card should still open, so the
// card is looked for in each other plant this user may open (one "All plants" read for Owner/Admin) and,
// when found, the active plant is switched to the card's plant and the page is asked again there.
// Used by the phone scan landing and the print page.

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useMemo, useState } from "react"

import { useAuth } from "@/context/AuthContext"
import { usePlants } from "@/hooks/use-system"
import { productionApi } from "@/lib/api"
import { displayPlantScope } from "@/lib/plant-scope"

export function useCardPlantFallback(jobCardId: string, cardQuery: { isError: boolean; error: unknown }, enabled = true) {
  const { user, activePlant, setActivePlant } = useAuth()
  const queryClient = useQueryClient()
  const plants = usePlants()
  const errorStatus = Number((cardQuery.error as any)?.response?.status || 0)
  // 422 is a link that is not a card id at all; 404 can be a card from another plant.
  const notFound = enabled && cardQuery.isError && (errorStatus === 404 || errorStatus === 422)
  const probePlants = useMemo(() => {
    if (!notFound || errorStatus !== 404 || !user || String(activePlant || "").toUpperCase() === "ALL") return []
    const roles = new Set([user.role, ...(user.roles || [])].filter(Boolean) as string[])
    if (user.is_owner_all_plants || roles.has("Owner") || roles.has("Admin")) return ["ALL"]
    return (user.allowed_plant_ids || []).filter((plant) => plant.toLowerCase() !== String(activePlant || "").toLowerCase())
  }, [notFound, errorStatus, user, activePlant])
  const elsewhere = useQuery({
    queryKey: ["job-card-other-plant", jobCardId, probePlants.join(",")],
    enabled: probePlants.length > 0,
    retry: false,
    queryFn: async () => {
      for (const plant of probePlants) {
        try {
          const { data } = await productionApi.getPlanningJobCard(jobCardId, plant)
          if (data?.plant_id) return String(data.plant_id)
        } catch (error: any) {
          if (![403, 404].includes(Number(error?.response?.status))) throw error
        }
      }
      return ""
    },
  })
  const [switchedTo, setSwitchedTo] = useState("")
  useEffect(() => {
    if (!elsewhere.data || switchedTo) return
    setSwitchedTo(elsewhere.data)
    setActivePlant(elsewhere.data)
    // Everything on the page was asked in the old plant: ask again in the card's plant.
    void queryClient.resetQueries()
  }, [elsewhere.data, switchedTo, setActivePlant, queryClient])

  const plantName = (id: string) => plants.data?.find((p: any) => String(p.id).toLowerCase() === id.toLowerCase())?.name || displayPlantScope(id, "the card's plant")
  return {
    /** The link matches no card in any plant this user may open (after the other plants were tried). */
    missing: notFound && !elsewhere.isError && !(probePlants.length > 0 && (elsewhere.isPending || elsewhere.isFetching)) && !elsewhere.data,
    /** Still looking in the other plants, or about to switch: show a loading state. */
    probing: (probePlants.length > 0 && (elsewhere.isPending || elsewhere.isFetching)) || Boolean(elsewhere.data && !switchedTo),
    failed: elsewhere.isError,
    retry: () => void elsewhere.refetch(),
    switchedTo,
    switchedToName: switchedTo ? plantName(switchedTo) : "",
    multiPlant: (user?.allowed_plant_ids?.length || 0) > 1,
  }
}
