"use client"

import React from "react"
import { useRouter } from "next/navigation"
import { Building2, Check, ChevronDown } from "lucide-react"
import { useAuth } from "@/context/AuthContext"
import { authApi } from "@/lib/api"
import { PLANT_SCOPE_LABELS, canonicalPlantScopeValue, displayPlantScope, plantScopeOptionLabel } from "@/lib/plant-scope"

type PlantOption = {
    id: string
    code?: string
    name?: string
    is_active?: boolean
}

function normalizePlantScopeValue(plant: PlantOption | null | undefined) {
    const id = String(plant?.id || "").trim()
    if (id && id.toUpperCase() !== "ALL") {
        return canonicalPlantScopeValue(id)
    }
    const code = String(plant?.code || "").trim()
    if (code) {
        return canonicalPlantScopeValue(code)
    }
    return id
}

export function PlantSwitcher({ compact = false }: { compact?: boolean }) {
    const router = useRouter()
    const { user, activePlant, setActivePlant } = useAuth()
    const [isOpen, setIsOpen] = React.useState(false)
    const [plants, setPlants] = React.useState<PlantOption[]>([])
    const [isLoading, setIsLoading] = React.useState(false)
    const allowedPlantIds = React.useMemo(
        () => Array.from(new Set([...(user?.allowed_plant_ids || []), ...(user?.allowed_plants || [])].filter(Boolean))),
        [user?.allowed_plant_ids, user?.allowed_plants],
    )

    const canSwitchPlants = React.useMemo(() => {
        const roles = new Set([user?.role, ...(user?.roles || [])].filter(Boolean))
        return roles.has("Owner") || roles.has("Admin")
    }, [user?.role, user?.roles])

    const canReadAllPlants = canSwitchPlants

    React.useEffect(() => {
        let cancelled = false

        async function loadPlants() {
            if (!user) return
            setIsLoading(true)
            try {
                const response = await authApi.getPlants()
                if (!cancelled) {
                    const rows = Array.isArray(response.data) ? response.data : []
                    setPlants(rows.filter((row) => row && row.is_active !== false))
                }
            } catch {
                if (!cancelled) {
                    setPlants([])
                }
            } finally {
                if (!cancelled) {
                    setIsLoading(false)
                }
            }
        }

        loadPlants()
        return () => {
            cancelled = true
        }
    }, [user])

    const resolvedPlants = React.useMemo(() => {
        if (plants.length > 0) return plants
        return Object.entries(PLANT_SCOPE_LABELS).map(([id, name]) => ({ id, code: id, name }))
    }, [plants])

    const visiblePlants = React.useMemo(() => {
        const filtered = resolvedPlants.filter((plant) => normalizePlantScopeValue(plant) !== "ALL")
        if (canReadAllPlants || allowedPlantIds.length === 0) {
            return filtered
        }
        return filtered.filter((plant) => {
            const values = [plant.id, plant.code, normalizePlantScopeValue(plant)].filter(Boolean)
            return values.some((value) => allowedPlantIds.includes(String(value)))
        })
    }, [allowedPlantIds, canReadAllPlants, resolvedPlants])

    const allPlantsOption = React.useMemo(
        () => resolvedPlants.find((plant) => normalizePlantScopeValue(plant) === "ALL"),
        [resolvedPlants],
    )

    const currentPlant = React.useMemo(
        () =>
            resolvedPlants.find((plant) => {
                const scopeValue = normalizePlantScopeValue(plant)
                return plant.id === activePlant || plant.code === activePlant || scopeValue === activePlant
            }),
        [activePlant, resolvedPlants],
    )

    const currentPlantName =
        (String(activePlant || "").toUpperCase() === "ALL" ? displayPlantScope("ALL") : null) ||
        currentPlant?.name ||
        displayPlantScope(activePlant, "Unknown Plant")

    const handlePlantChange = (nextPlant: string) => {
        setActivePlant(nextPlant)
        setIsOpen(false)
        router.refresh()
        window.location.reload()
    }

    if (!user) {
        return null
    }

    if (!canSwitchPlants) {
        return (
            <div
                className={`flex items-center gap-2 rounded-full border shadow-sm ${
                    compact
                        ? "border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-700"
                        : "border-white/70 bg-slate-900 px-3 py-2 text-[11px] font-semibold text-slate-50"
                }`}
            >
                <Building2 className="h-3 w-3" />
                <span className="max-w-[180px] truncate uppercase tracking-[0.18em]">{currentPlantName}</span>
            </div>
        )
    }

    return (
        <div className="relative">
            <button
                data-testid="plant-switcher-trigger"
                onClick={() => setIsOpen(!isOpen)}
                className={`flex items-center gap-2 rounded-full border px-3 py-2 text-[11px] font-semibold shadow-sm transition ${
                    compact
                        ? "border-slate-200 bg-white text-slate-600 hover:border-cyan-200 hover:text-cyan-900"
                        : "border-white/70 bg-white/92 text-slate-700 hover:border-cyan-200 hover:text-cyan-900"
                }`}
            >
                <Building2 className="h-3 w-3" />
                <span className="max-w-[180px] truncate uppercase tracking-[0.18em]">{currentPlantName}</span>
                <ChevronDown className={`h-3 w-3 transition-transform ${isOpen ? "rotate-180" : ""}`} />
            </button>

            {isOpen && (
                <>
                    <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />
                    <div className="absolute right-0 z-20 mt-2 w-64 rounded-2xl border border-white/70 bg-white/95 p-2 shadow-2xl backdrop-blur">
                        <p className="px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-400">
                            Select Plant
                        </p>
                        {canReadAllPlants ? (
                            <button
                                key={allPlantsOption?.id || "ALL"}
                                data-testid={`plant-option:${allPlantsOption?.id || "ALL"}`}
                                onClick={() => handlePlantChange("ALL")}
                                className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                                    activePlant === "ALL"
                                        ? "bg-cyan-50 text-cyan-900"
                                        : "text-slate-700 hover:bg-slate-50"
                                }`}
                            >
                                <div className="min-w-0">
                                    <span className="block truncate text-sm font-medium">All Visible Plants</span>
                                    <span className="block text-[10px] opacity-60">ALL · read-only scope</span>
                                </div>
                                {activePlant === "ALL" ? <Check className="h-4 w-4 shrink-0" /> : null}
                            </button>
                        ) : null}
                        {visiblePlants.map((plant) => (
                            <button
                                key={plant.id}
                                data-testid={`plant-option:${plant.id}`}
                                onClick={() => handlePlantChange(normalizePlantScopeValue(plant))}
                                className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition ${activePlant === plant.id || activePlant === plant.code || activePlant === normalizePlantScopeValue(plant)
                                    ? "bg-cyan-50 text-cyan-900"
                                    : "text-slate-700 hover:bg-slate-50"
                                    }`}
                            >
                                <div className="min-w-0">
                                    <span className="block truncate text-sm font-medium">{plantScopeOptionLabel(plant)}</span>
                                    <span className="block text-[10px] opacity-60">{displayPlantScope(normalizePlantScopeValue(plant))}</span>
                                </div>
                                {activePlant === plant.id || activePlant === plant.code || activePlant === normalizePlantScopeValue(plant) ? (
                                    <Check className="h-4 w-4 shrink-0" />
                                ) : null}
                            </button>
                        ))}
                        {isLoading ? (
                            <p className="px-3 py-2 text-[11px] text-slate-400">Refreshing plants…</p>
                        ) : null}
                    </div>
                </>
            )}
        </div>
    )
}
