import { useMemo } from "react"

import { displayPlantScope } from "@/lib/plant-scope"
import { usePlants } from "@/hooks/use-system"

function normalize(value: string | null | undefined) {
  return String(value || "").trim().toUpperCase()
}

export function usePlantScopeLabel(plantId: string | null | undefined, fallback = "All Visible Plants") {
  const { data: plants } = usePlants()

  return useMemo(() => {
    const normalized = normalize(plantId)
    if (!normalized || normalized === "ALL") return displayPlantScope("ALL", fallback)

    const match = (Array.isArray(plants) ? plants : []).find((plant: any) => {
      const candidates = [plant?.id, plant?.code, plant?.name].map(normalize)
      return candidates.includes(normalized)
    })

    if (match) {
      return match.name || match.code || displayPlantScope(match.id, fallback)
    }

    return displayPlantScope(plantId, fallback)
  }, [fallback, plantId, plants])
}
