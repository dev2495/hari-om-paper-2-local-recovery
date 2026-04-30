export const PLANT_SCOPE_LABELS: Record<string, string> = {
  ALL: "All Visible Plants",
  PLANT_A: "Plant A",
  PLANT_B: "Plant B",
  "00000000-0000-0000-0000-0000000000a1": "Plant A",
  "00000000-0000-0000-0000-0000000000b2": "Plant B",
}

export const PLANT_SCOPE_ALIASES: Record<string, string> = {
  PLANT_A: "00000000-0000-0000-0000-0000000000a1",
  "PLANT-1": "00000000-0000-0000-0000-0000000000a1",
  PLANT_1: "00000000-0000-0000-0000-0000000000a1",
  PLANT1: "00000000-0000-0000-0000-0000000000a1",
  PLANT_B: "00000000-0000-0000-0000-0000000000b2",
  "PLANT-2": "00000000-0000-0000-0000-0000000000b2",
  PLANT_2: "00000000-0000-0000-0000-0000000000b2",
  PLANT2: "00000000-0000-0000-0000-0000000000b2",
}

export function canonicalPlantScopeValue(value: string | null | undefined) {
  const normalized = String(value || "").trim()
  if (!normalized) return normalized
  const upper = normalized.toUpperCase()
  if (upper === "ALL") return "ALL"
  return PLANT_SCOPE_ALIASES[upper] || normalized
}

export function displayPlantScope(value: string | null | undefined, fallback = "No plant selected") {
  const normalized = String(value || "").trim()
  if (!normalized) return fallback
  return PLANT_SCOPE_LABELS[normalized.toUpperCase()] || PLANT_SCOPE_LABELS[normalized] || PLANT_SCOPE_LABELS[normalized.toLowerCase()] || normalized
}

export function plantScopeOptionLabel(plant: { id?: string; code?: string; name?: string } | null | undefined) {
  const label = plant?.name || displayPlantScope(plant?.code || plant?.id, "")
  const code = displayPlantScope(plant?.code || plant?.id, "")
  if (!label) return "Unknown plant"
  if (!code || label === code) return label
  return `${code} - ${label}`
}
