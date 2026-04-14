"use client"

import React from "react"
import { Building2, Check, ChevronDown } from "lucide-react"
import { useAuth } from "@/context/AuthContext"
import { authApi } from "@/lib/api"

type PlantOption = {
    id: string
    code?: string
    name?: string
    is_active?: boolean
}

const FALLBACK_PLANT_LABELS: Record<string, string> = {
    PLANT_A: "Plant A",
    PLANT_B: "Plant B",
    ALL: "All Visible Plants",
}

export function PlantSwitcher({ compact = false }: { compact?: boolean }) {
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
        return Object.entries(FALLBACK_PLANT_LABELS).map(([id, name]) => ({ id, code: id, name }))
    }, [plants])

    const visiblePlants = React.useMemo(() => {
        const filtered = resolvedPlants.filter((plant) => plant.id !== "ALL" && plant.code !== "ALL")
        if (user?.is_owner_all_plants || allowedPlantIds.length === 0) {
            return filtered
        }
        return filtered.filter((plant) => {
            const values = [plant.id, plant.code].filter(Boolean)
            return values.some((value) => allowedPlantIds.includes(String(value)))
        })
    }, [allowedPlantIds, resolvedPlants, user?.is_owner_all_plants])

    const currentPlant = React.useMemo(
        () => resolvedPlants.find((plant) => plant.id === activePlant || plant.code === activePlant),
        [activePlant, resolvedPlants],
    )

    const currentPlantName =
        currentPlant?.name ||
        currentPlant?.code ||
        FALLBACK_PLANT_LABELS[String(activePlant || "").toUpperCase()] ||
        activePlant ||
        "Unknown Plant"

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
                        {user?.is_owner_all_plants ? (
                            <button
                                key="ALL"
                                onClick={() => {
                                    setActivePlant("ALL")
                                    setIsOpen(false)
                                    window.location.reload()
                                }}
                                className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                                    activePlant === "ALL"
                                        ? "bg-cyan-50 text-cyan-900"
                                        : "text-slate-700 hover:bg-slate-50"
                                }`}
                            >
                                <div className="min-w-0">
                                    <span className="block truncate text-sm font-medium">All Visible Plants</span>
                                    <span className="block text-[10px] opacity-60">ALL</span>
                                </div>
                                {activePlant === "ALL" ? <Check className="h-4 w-4 shrink-0" /> : null}
                            </button>
                        ) : null}
                        {visiblePlants.map((plant) => (
                            <button
                                key={plant.id}
                                onClick={() => {
                                    setActivePlant(plant.id)
                                    setIsOpen(false)
                                    window.location.reload()
                                }}
                                className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition ${activePlant === plant.id || activePlant === plant.code
                                    ? "bg-cyan-50 text-cyan-900"
                                    : "text-slate-700 hover:bg-slate-50"
                                    }`}
                            >
                                <div className="min-w-0">
                                    <span className="block truncate text-sm font-medium">{plant.name || plant.code || plant.id}</span>
                                    <span className="block text-[10px] opacity-60">{plant.code || plant.id}</span>
                                </div>
                                {activePlant === plant.id || activePlant === plant.code ? (
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
